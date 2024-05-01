/**
 * Copyright (c) 2022-2024, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import {
    BasicUserInfo,
    DecodedIDTokenPayload,
    Hooks,
    SecureApp,
    useAuthContext
} from "@asgardeo/auth-react";
import {
    AccessControlProvider,
    AllFeatureInterface,
    FeatureGateInterface
} from "@thiva/access-control";
import {
    AppConstants as CommonAppConstants } from "@thiva/core/constants";
import { IdentityAppsApiException } from "@thiva/core/exceptions";
import { IdentifiableComponentInterface } from "@thiva/core/models";
import {
    setDeploymentConfigs,
    setSupportedI18nLanguages,
    setUIConfigs
} from "@thiva/core/store";
import {
    AuthenticateUtils as CommonAuthenticateUtils,
    SessionStorageUtils,
    StringUtils
} from "@thiva/core/utils";
import useSignIn from "@thiva/features/admin.authentication.v1/hooks/use-sign-in";
import useAuthorization from "@thiva/features/admin.authorization.v1/hooks/use-authorization";
import {
    AppState,
    AppUtils,
    Config,
    DeploymentConfigInterface,
    HttpUtils,
    PreLoader,
    UIConfigInterface,
    getAppViewRoutes,
    setFilteredDevelopRoutes,
    setSanitizedDevelopRoutes,
    store
} from "@thiva/features/admin.core.v1";
import { AppConstants } from "@thiva/features/admin.core.v1/constants";
import { history } from "@thiva/features/admin.core.v1/helpers";
import useUIConfig from "@thiva/features/admin.core.v1/hooks/use-ui-configs";
import { commonConfig } from "@thiva/features/admin.extensions.v1";
import { useGetAllFeatures } from "@thiva/features/admin.extensions.v1/components/feature-gate/api/feature-gate";
import useTenantTier from "@thiva/features/admin.extensions.v1/components/subscription/api/subscription";
import { TenantTier } from "@thiva/features/admin.extensions.v1/components/subscription/models/subscription";
import { SubscriptionProvider }
    from "@thiva/features/admin.extensions.v1/components/subscription/providers/subscription-provider";
import { featureGateConfig } from "@thiva/features/admin.extensions.v1/configs/feature-gate";
import useOrganizationSwitch from "@thiva/features/admin.organizations.v1/hooks/use-organization-switch";
import { OrganizationUtils } from "@thiva/features/admin.organizations.v1/utils";
import {
    I18n,
    I18nInstanceInitException,
    I18nModuleConstants,
    LanguageChangeException,
    isLanguageSupported
} from "@thiva/i18n";
import axios, { AxiosResponse } from "axios";
import has from "lodash-es/has";
import set from "lodash-es/set";
import React, {
    FunctionComponent,
    LazyExoticComponent,
    ReactElement,
    lazy,
    useEffect,
    useState
} from "react";
import { I18nextProvider } from "react-i18next";
import { useDispatch, useSelector } from "react-redux";
import { Dispatch } from "redux";

const App: LazyExoticComponent<FunctionComponent> = lazy(() => import("./app"));

type AppPropsInterface = IdentifiableComponentInterface;

/**
 * This component warps the `App` component with the `SecureApp` component to provide automatic authentication.
 *
 * @returns ProtectedApp component (React Element)
 */
export const ProtectedApp: FunctionComponent<AppPropsInterface> = (): ReactElement => {
    const featureGateConfigUpdated : FeatureGateInterface = { ...featureGateConfig };

    const {
        on,
        signIn,
        getDecodedIDToken,
        state
    } = useAuthContext();

    const dispatch: Dispatch<any> = useDispatch();

    const { onSignIn } = useSignIn();

    const { switchOrganization } = useOrganizationSwitch();

    const { legacyAuthzRuntime }  = useAuthorization();

    const { setUIConfig } = useUIConfig();

    const { data: tenantTier } = useTenantTier();

    const organizationType: string = useSelector((state: AppState) => state?.organization?.organizationType);
    const allowedScopes: string = useSelector((state: AppState) => state?.auth?.allowedScopes);

    const [ featureGateConfigData, setFeatureGateConfigData ] =
        useState<FeatureGateInterface | null>(featureGateConfigUpdated);
    const [ renderApp, setRenderApp ] = useState<boolean>(false);
    const [ orgId, setOrgId ] = useState<string>();

    const {
        data: allFeatures,
        error: featureGateAPIException
    } = useGetAllFeatures(orgId, state.isAuthenticated);

    useEffect(() => {
        dispatch(
            setDeploymentConfigs<DeploymentConfigInterface>(
                Config.getDeploymentConfig()
            )
        );
        dispatch(setUIConfigs<UIConfigInterface>(Config.getUIConfig()));
        setUIConfig(Config.getUIConfig());
    }, []);

    useEffect(() => {
        dispatch(setFilteredDevelopRoutes(getAppViewRoutes()));
        dispatch(setSanitizedDevelopRoutes(getAppViewRoutes()));
    }, [ dispatch ]);

    useEffect(() => {
        on(Hooks.HttpRequestError, HttpUtils.onHttpRequestError);
        on(Hooks.HttpRequestFinish, HttpUtils.onHttpRequestFinish);
        on(Hooks.HttpRequestStart, HttpUtils.onHttpRequestStart);
        on(Hooks.HttpRequestSuccess, HttpUtils.onHttpRequestSuccess);

        on(Hooks.SignIn, async (signInResponse: BasicUserInfo) => {
            let response: BasicUserInfo = null;

            const getOrganizationName = () => {
                const path: string = SessionStorageUtils.getItemFromSessionStorage("auth_callback_url_console")
                    ?? window.location.pathname;
                const pathChunks: string[] = path.split("/");

                const orgPrefixIndex: number = pathChunks.indexOf(Config.getDeploymentConfig().organizationPrefix);

                if (orgPrefixIndex !== -1) {
                    return pathChunks[ orgPrefixIndex + 1 ];
                }

                return "";
            };

            try {
                // The organization switch is not needed for organization users who directly SSO to the organization.
                if (getOrganizationName() && signInResponse.userOrg != signInResponse.orgId) {
                    response = await switchOrganization(getOrganizationName());
                } else {
                    response = { ...signInResponse };
                }

                await onSignIn(
                    response,
                    () => null,
                    (idToken: DecodedIDTokenPayload) => loginSuccessRedirect(idToken),
                    () => setRenderApp(true)
                );
            } catch(e) {
                // TODO: Handle error
            }
        });
    }, []);

    useEffect(() => {
        if (allFeatures instanceof IdentityAppsApiException || featureGateAPIException) {
            return;
        }

        if (!allFeatures) {
            return;
        }

        if (allFeatures?.length > 0) {
            allFeatures.forEach((feature: AllFeatureInterface )=> {
                // converting the identifier to path.
                const path: string = feature.featureIdentifier.replace(/-/g, ".");
                // Obtain the status and set it to the feature gate config.
                const featureStatusPath: string = `${ path }.status`;

                set(featureGateConfigUpdated,featureStatusPath, feature.featureStatus);

                const featureTagPath: string = `${ path }.tags`;

                set(featureGateConfigUpdated,featureTagPath, feature.featureTags);

                setFeatureGateConfigData(featureGateConfigUpdated);
            });
        }
    }, [ allFeatures ]);

    useEffect(() => {
        if(state.isAuthenticated) {
            if (OrganizationUtils.isSuperOrganization(store.getState().organization.organization)
            || store.getState().organization.isFirstLevelOrganization) {
                getDecodedIDToken().then((response: DecodedIDTokenPayload)=>{
                    const orgName: string = response.org_name;
                    // Set org_name instead of org_uuid as the API expects org_name
                    // as it resolves tenant uuid from it.

                    setOrgId(orgName);
                });
            } else {
                // Set the sub org id to the current organization id.
                setOrgId(store.getState().organization.organization.id);
            }
        }
    }, [ state ]);

    const loginSuccessRedirect = (idToken: DecodedIDTokenPayload): void => {
        const AuthenticationCallbackUrl: string = CommonAuthenticateUtils.getAuthenticationCallbackUrl(
            CommonAppConstants.CONSOLE_APP
        );

        /**
         * Prevent redirect to landing page when there is no association.
         */
        if (commonConfig?.enableOrganizationAssociations) {

            const isPrivilegedUser: boolean =
                idToken?.amr?.length > 0
                    ? idToken?.amr[ 0 ] === "EnterpriseIDPAuthenticator"
                    : false;

            let isOrgSwitch: boolean = false;

            if (has(idToken, "org_id") && has(idToken, "user_org")) {
                isOrgSwitch = (idToken?.org_id !== idToken?.user_org);
            }
            if (has(idToken, "associated_tenants") || isPrivilegedUser || isOrgSwitch) {
                // If there is an association, the user should be redirected to console landing page.
                const location: string =
                    !AuthenticationCallbackUrl ||
                    (AuthenticationCallbackUrl ===
                        AppConstants.getAppLoginPath() ||
                            AuthenticationCallbackUrl ===
                            `${AppConstants.getAppLoginPath()}/`) ||
                            AuthenticationCallbackUrl ===
                            `${ window[ "AppUtils" ].getConfig()
                                .appBaseWithTenant
                            }/` ||
                        AppUtils.isAuthCallbackURLFromAnotherTenant(
                            AuthenticationCallbackUrl, CommonAuthenticateUtils.deriveTenantDomainFromSubject(
                                idToken.sub))
                        ? AppConstants.getAppHomePath()
                        : AuthenticationCallbackUrl;

                history.push(location);
            } else {
                // If there is no assocation, the user should be redirected to creation flow.
                history.push({
                    pathname: AppConstants.getPaths().get(
                        "CREATE_TENANT"
                    )
                });
            }
        } else {
            const location: string =
                !AuthenticationCallbackUrl ||
                    (AuthenticationCallbackUrl ===
                        AppConstants.getAppLoginPath() ||
                            AuthenticationCallbackUrl ===
                            `${AppConstants.getAppLoginPath()}/`) ||
                        AuthenticationCallbackUrl ===
                        `${ window[ "AppUtils" ].getConfig().appBaseWithTenant }/` ||
                    AppUtils.isAuthCallbackURLFromAnotherTenant(
                        AuthenticationCallbackUrl,
                        CommonAuthenticateUtils.deriveTenantDomainFromSubject(idToken.sub)
                    )
                    ? AppConstants.getAppHomePath()
                    : AuthenticationCallbackUrl;

            history.push(location);
        }
    };

    useEffect(() => {
        const error: string = new URLSearchParams(location.search).get(
            "error_description"
        );

        if (error === AppConstants.USER_DENIED_CONSENT_SERVER_ERROR) {
            history.push({
                pathname: AppConstants.getPaths().get("UNAUTHORIZED"),
                search:
                    "?error=" +
                    AppConstants.LOGIN_ERRORS.get("USER_DENIED_CONSENT")
            });

            return;
        }
    }, []);

    /**
     * Load localization files.
     */
    useEffect(() => {
        if (!state.isAuthenticated) {
            return;
        }

        // If `appBaseNameWithoutTenant` is "", avoids adding a forward slash.
        const resolvedAppBaseNameWithoutTenant: string = StringUtils.removeSlashesFromPath(
            Config.getDeploymentConfig().appBaseNameWithoutTenant
        )
            ? `/${ StringUtils.removeSlashesFromPath(
                Config.getDeploymentConfig().appBaseNameWithoutTenant
            ) }`
            : "";

        const metaFileNames: string[] = I18nModuleConstants.META_FILENAME.split(".");
        const metaFileName: string = `${ metaFileNames[ 0 ] }.${ process.env.metaHash }.${ metaFileNames[ 1 ] }`;

        // Since the portals are not deployed per tenant, looking for static resources in tenant qualified URLs
        // will fail. This constructs the path without the tenant, therefore it'll look for the file in
        // `https://localhost:9443/<PORTAL>/resources/i18n/meta.json` rather than looking for the file in
        // `https://localhost:9443/t/wso2.com/<PORTAL>/resources/i18n/meta.json`.
        const metaPath: string = `${ resolvedAppBaseNameWithoutTenant }/${ StringUtils.removeSlashesFromPath(
            Config.getI18nConfig().resourcePath
        ) }/${ metaFileName }`;

        // Fetch the meta file to get the supported languages and paths.
        axios
            .get(metaPath)
            .then((response: AxiosResponse) => {
                // Set up the i18n module.
                I18n.init(
                    {
                        ...Config.getI18nConfig(response?.data)?.initOptions,
                        debug: window[ "AppUtils" ].getConfig().debug
                    },
                    Config.getI18nConfig()?.overrideOptions,
                    Config.getI18nConfig()?.langAutoDetectEnabled,
                    Config.getI18nConfig()?.xhrBackendPluginEnabled
                ).then(() => {
                    // Set the supported languages in redux store.
                    store.dispatch(setSupportedI18nLanguages(response?.data));

                    const isSupported: boolean = isLanguageSupported(
                        I18n.instance.language,
                        null,
                        response?.data
                    );

                    if (!isSupported) {
                        I18n.instance
                            .changeLanguage(
                                I18nModuleConstants.DEFAULT_FALLBACK_LANGUAGE
                            )
                            .catch((error: any) => {
                                throw new LanguageChangeException(
                                    I18nModuleConstants.DEFAULT_FALLBACK_LANGUAGE,
                                    error
                                );
                            });
                    }
                });
            })
            .catch((error: any) => {
                throw new I18nInstanceInitException(error);
            });
    }, [ state.isAuthenticated ]);

    return (
        <SecureApp
            fallback={ <PreLoader /> }
            overrideSignIn={ async () => {
                // This is to prompt the SSO page if a user tries to sign in
                // through a federated IdP using an existing email address.
                // eslint-disable-next-line no-restricted-globals
                if (new URL(location.href).searchParams.get("prompt")) {
                    await signIn({ prompt: "login" });
                } else {
                    await signIn();
                }
            } }
        >
            <AccessControlProvider
                allowedScopes={ allowedScopes }
                features={ featureGateConfigData }
                isLegacyRuntimeEnabled={ legacyAuthzRuntime }
                organizationType={ organizationType }
            >
                <I18nextProvider i18n={ I18n.instance }>
                    <SubscriptionProvider tierName={ tenantTier?.tierName ?? TenantTier.FREE }>
                        { renderApp ? <App /> : <PreLoader /> }
                    </SubscriptionProvider>
                </I18nextProvider>
            </AccessControlProvider>
        </SecureApp>
    );
};
