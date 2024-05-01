/**
 * Copyright (c) 2023, thiva LLC. (https://www.thiva.com).
 *
 * thiva LLC. licenses this file to you under the Apache License,
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

import { BasicUserInfo, DecodedIDTokenPayload, useAuthContext } from "@asgardeo/auth-react";
import { useRequiredScopes } from "@thiva/access-control";
import { AppConstants as CommonAppConstants } from "@thiva/core/constants";
import { IdentityAppsApiException } from "@thiva/core/exceptions";
import { CommonHelpers, isPortalAccessGranted } from "@thiva/core/helpers";
import { RouteInterface, StorageIdentityAppsSettingsInterface, emptyIdentityAppsSettings } from "@thiva/core/models";
import { setI18nConfigs, setServiceResourceEndpoints } from "@thiva/core/store";
import { AuthenticateUtils, LocalStorageUtils } from "@thiva/core/utils";
import { EventPublisher, PreLoader } from "@thiva/features/admin.core.v1";
import { ProtectedRoute } from "@thiva/features/admin.core.v1/components";
import { Config, DocumentationLinks, getBaseRoutes } from "@thiva/features/admin.core.v1/configs";
import { AppConstants } from "@thiva/features/admin.core.v1/constants";
import { history } from "@thiva/features/admin.core.v1/helpers";
import useResourceEndpoints from "@thiva/features/admin.core.v1/hooks/use-resource-endpoints";
import useRoutes from "@thiva/features/admin.core.v1/hooks/use-routes";
import {
    ConfigReducerStateInterface,
    DocumentationLinksInterface,
    FeatureConfigInterface,
    ServiceResourceEndpointsInterface
} from "@thiva/features/admin.core.v1/models";
import { AppState } from "@thiva/features/admin.core.v1/store";
import { commonConfig } from "@thiva/features/admin.extensions.v1";
import {
    GovernanceCategoryForOrgsInterface,
    useGovernanceConnectorCategories
} from "@thiva/features/admin.server-configurations.v1";
import { I18nModuleOptionsInterface } from "@thiva/i18n";
import {
    ChunkErrorModal,
    Code,
    DocumentationProvider,
    MediaContextProvider,
    NetworkErrorModal,
    SessionManagementProvider,
    SessionTimeoutModalTypes
} from "@thiva/react-components";
import has from "lodash-es/has";
import isEmpty from "lodash-es/isEmpty";
import * as moment from "moment";
import React, { FunctionComponent, ReactElement, Suspense, useEffect, useState } from "react";
import { Helmet } from "react-helmet";
import { Trans } from "react-i18next";
import { useDispatch, useSelector } from "react-redux";
import { StaticContext } from "react-router";
import { Redirect, Route, RouteComponentProps, Router, Switch } from "react-router-dom";
import { Dispatch } from "redux";
import "moment/locale/si";
import "moment/locale/fr";

/**
 * Main App component.
 *
 * @returns App Root component.
 */
export const App: FunctionComponent<Record<string, never>> = (): ReactElement => {

    const dispatch: Dispatch<any> = useDispatch();

    const { filterRoutes } = useRoutes();

    const eventPublisher: EventPublisher = EventPublisher.getInstance();

    const { trySignInSilently, getDecodedIDToken, signOut, state } = useAuthContext();

    const { setResourceEndpoints } = useResourceEndpoints();

    const userName: string = useSelector((state: AppState) => state.auth.username);
    const loginInit: boolean = useSelector((state: AppState) => state.auth.loginInit);
    const isPrivilegedUser: boolean = useSelector((state: AppState) => state.auth.isPrivilegedUser);
    const config: ConfigReducerStateInterface = useSelector((state: AppState) => state.config);
    const appTitle: string = useSelector((state: AppState) => state?.config?.ui?.appTitle);
    const uuid: string = useSelector((state: AppState) => state.profile.profileInfo.id);
    const theme: string = useSelector((state: AppState) => state?.config?.ui?.theme?.name);
    const isFirstLevelOrg: boolean = useSelector(
        (state: AppState) => state.organization.isFirstLevelOrganization
    );
    const featureConfig: FeatureConfigInterface = useSelector(
        (state: AppState) => state.config.ui.features
    );
    const allowedScopes: string = useSelector((state: AppState) => state?.auth?.allowedScopes);

    const [ baseRoutes, setBaseRoutes ] = useState<RouteInterface[]>(getBaseRoutes());
    const [ sessionTimedOut, setSessionTimedOut ] = useState<boolean>(false);
    const [ routesFiltered, setRoutesFiltered ] = useState<boolean>(false);
    const [ governanceConnectors, setGovernanceConnectors ] = useState<GovernanceCategoryForOrgsInterface[]>([]);

    const hasGovernanceConnectorsReadScope: boolean = useRequiredScopes(
        featureConfig?.governanceConnectors?.scopes?.read);

    const {
        data: originalConnectorCategories,
        error: connectorCategoriesFetchRequestError
    } = useGovernanceConnectorCategories(
        featureConfig?.server?.enabled && isFirstLevelOrg &&
        hasGovernanceConnectorsReadScope);

    /**
     * Set the deployment configs in redux state.
     */
    useEffect(() => {
        sessionStorageDisabled();
    }, []);

    /**
     * Set the initial locale in moment
     */
    useEffect(() => {
        moment.locale("en");
    }, []);

    /**
     * Set the deployment configs in redux state.
     */
    useEffect(() => {
        dispatch(setServiceResourceEndpoints<ServiceResourceEndpointsInterface>(Config.getServiceResourceEndpoints()));
        dispatch(setI18nConfigs<I18nModuleOptionsInterface>(Config.getI18nConfig()));
        setResourceEndpoints(Config.getServiceResourceEndpoints() as any);
    }, [ AppConstants.getTenantQualifiedAppBasename() ]);

    /**
     * Listen for base name changes and updated the routes.
     */
    useEffect(() => {
        setBaseRoutes(getBaseRoutes());
    }, [ AppConstants.getTenantQualifiedAppBasename() ]);

    /**
     * Set the application settings of the user to the local storage.
     */
    useEffect(() => {
        if (!userName || !config?.deployment?.tenant) {
            return;
        }

        const tenant: string = config.deployment.tenant;
        const tenantAppSettings: Record<string, unknown> = JSON.parse(
            LocalStorageUtils.getValueFromLocalStorage(tenant)
        );
        const appSettings: Record<string, StorageIdentityAppsSettingsInterface> = {};

        appSettings[ userName ] = emptyIdentityAppsSettings();

        if (!tenantAppSettings) {
            LocalStorageUtils.setValueInLocalStorage(tenant, JSON.stringify(appSettings));
        } else {
            if (CommonHelpers.lookupKey(tenantAppSettings, userName) === null) {
                const newUserSettings: Record<string, unknown> = {
                    ...tenantAppSettings,
                    [ userName ]: emptyIdentityAppsSettings()
                };

                LocalStorageUtils.setValueInLocalStorage(tenant, JSON.stringify(newUserSettings));
            }
        }
    }, [ config?.deployment?.tenant, userName ]);

    /**
     * Checks if the portal access should be granted based on the feature config.
     */
    useEffect(() => {
        if (!config?.ui?.features || !loginInit) {
            return;
        }

        if (isPortalAccessGranted<FeatureConfigInterface>(config?.ui?.features, allowedScopes)) {
            return;
        }

        if (commonConfig?.enableOrganizationAssociations) {
            /**
             * Checks if the portal access is denied due to no association.
             */
            getDecodedIDToken()
                .then((idToken: DecodedIDTokenPayload) => {

                    if(has(idToken, "associated_tenants") || isPrivilegedUser) {
                        // If there is an association, the user is likely unauthorized by other criteria.
                        history.push({
                            pathname: AppConstants.getPaths().get("UNAUTHORIZED"),
                            search: "?error=" + AppConstants.LOGIN_ERRORS.get("ACCESS_DENIED")
                        });
                    } else {
                        // If there is no association, the user should be redirected to creation flow.
                        history.push({
                            pathname: AppConstants.getPaths().get("CREATE_TENANT")
                        });
                    }
                })
                .catch(() => {
                    // No need to show UI errors here.
                    // Add debug logs here one a logger is added.
                    // Tracked here https://github.com/thiva/product-is/issues/11650.
                });
        } else {
            history.push({
                pathname: AppConstants.getPaths().get("UNAUTHORIZED"),
                search: "?error=" + AppConstants.LOGIN_ERRORS.get("ACCESS_DENIED")
            });
        }
    }, [ config, loginInit ]);

    /**
     * Publish page visit when the UUID is set.
     */
    useEffect(() => {
        if (!uuid) {
            return;
        }
        eventPublisher.publish("page-visit-console-landing-page");
    }, [ uuid ]);

    useEffect(() => {
        if (!state.isAuthenticated) {
            return;
        }

        filterRoutes(() => setRoutesFiltered(true), isFirstLevelOrg);
    }, [ filterRoutes, governanceConnectors, state.isAuthenticated, isFirstLevelOrg ]);

    useEffect(() => {
        if (!originalConnectorCategories ||
            originalConnectorCategories instanceof IdentityAppsApiException ||
            connectorCategoriesFetchRequestError) {
            return;
        }

        setGovernanceConnectors(originalConnectorCategories);
    }, [ originalConnectorCategories ]);

    /**
     * Set the value of Session Timed Out.
     */
    const handleSessionTimeOut = (timedOut: boolean): void => {
        setSessionTimedOut(timedOut);
    };

    /**
     * Handles session timeout abort.
     *
     * @param url - Current URL.
     */
    const handleSessionTimeoutAbort = (url: URL): void => {
        history.push({
            pathname: url.pathname,
            search: url.search
        });
    };

    /**
     * Handles session logout.
     */
    const handleSessionLogout = (): void => {
        AuthenticateUtils.removeAuthenticationCallbackUrl(CommonAppConstants.CONSOLE_APP);
        history.push(AppConstants.getAppLogoutPath());
    };

    const sessionStorageDisabled = () => {
        try {
            const storage: Storage = sessionStorage;

            // eslint-disable-next-line no-restricted-globals
            if (!storage && location.pathname !== AppConstants.getPaths().get("STORING_DATA_DISABLED")) {
                history.push(AppConstants.getPaths().get("STORING_DATA_DISABLED"));
            }
        } catch {
            // eslint-disable-next-line no-restricted-globals
            if (true && location.pathname !== AppConstants.getPaths().get("STORING_DATA_DISABLED")) {
                history.push(AppConstants.getPaths().get("STORING_DATA_DISABLED"));
            }
        }
    };

    /**
     * Handles the `stay logged in` option of the session management modal.
     * Sets a URL search param to notify the session management iframe to
     * do the necessary actions.
     */
    const handleStayLoggedIn = (): void => {
        trySignInSilently()
            .then((response: boolean | BasicUserInfo) => {
                if (response === false) {
                    AuthenticateUtils.removeAuthenticationCallbackUrl(CommonAppConstants.CONSOLE_APP);

                    history.push(AppConstants.getAppLogoutPath());
                } else {
                    window.history.replaceState(null, null, window.location.pathname);
                }
            })
            .catch(() => {
                AuthenticateUtils.removeAuthenticationCallbackUrl(CommonAppConstants.CONSOLE_APP);

                history.push(AppConstants.getAppLogoutPath());
            });
    };

    if (!routesFiltered || isEmpty(config?.deployment) || isEmpty(config?.endpoints)) {
        return <PreLoader/>;
    }

    return (
        <Router history={ history }>
            <div className="container-fluid">
                    <DocumentationProvider<DocumentationLinksInterface> links={ DocumentationLinks }>
                        <Suspense fallback={ <PreLoader /> }>
                            <MediaContextProvider>
                                <SessionManagementProvider
                                    onSessionTimeoutAbort={ handleSessionTimeoutAbort }
                                    onSessionLogout={ handleSessionLogout }
                                    onLoginAgain={ handleStayLoggedIn }
                                    setSessionTimedOut={ handleSessionTimeOut }
                                    sessionTimedOut={ sessionTimedOut }
                                    modalOptions={ {
                                        description: (
                                            <Trans
                                                i18nKey={
                                                    "console:common.modals.sessionTimeoutModal." +
                                                    "description"
                                                }
                                            >
                                                When you click on the <Code>Go back</Code> button, we
                                                will try to recover the session if it exists. If you
                                                don&apos;t have an active session, you will be
                                                redirected to the login page
                                            </Trans>
                                        ),
                                        headingI18nKey: "console:common.modals.sessionTimeoutModal" +
                                            ".heading",
                                        loginAgainButtonText: (
                                            <Trans
                                                i18nKey={
                                                    "console:common.modals" +
                                                    ".sessionTimeoutModal.loginAgainButton"
                                                }>
                                                Login again
                                            </Trans>
                                        ),
                                        primaryButtonText: (
                                            <Trans
                                                i18nKey={
                                                    "console:common.modals" +
                                                    ".sessionTimeoutModal.primaryButton"
                                                }>
                                                Go back
                                            </Trans>
                                        ),
                                        secondaryButtonText: (
                                            <Trans
                                                i18nKey={
                                                    "console:common.modals" +
                                                    ".sessionTimeoutModal.secondaryButton"
                                                }>
                                                Logout
                                            </Trans>
                                        ),
                                        sessionTimedOutDescription: (
                                            <Trans
                                                i18nKey={
                                                    "console:common.modals" +
                                                    ".sessionTimeoutModal.sessionTimedOutDescription"
                                                }>
                                                Please log in again to continue from where you left off.
                                            </Trans>
                                        ),
                                        sessionTimedOutHeadingI18nKey: "console:common.modals" +
                                            ".sessionTimeoutModal.sessionTimedOutHeading"
                                    } }
                                    type={ SessionTimeoutModalTypes.DEFAULT }
                                >
                                    <>
                                        <Helmet>
                                            <title>{ appTitle }</title>
                                            {
                                                // (window?.themeHash && window?.publicPath && theme)
                                                //     ? (
                                                //         <link
                                                //             href={
                                                //                 `${
                                                //                     window?.origin
                                                //                 }${
                                                //                     window?.publicPath
                                                //                 }/libs/themes/${
                                                //                     theme
                                                //                 }/theme.${ window?.themeHash }.min.css`
                                                //             }
                                                //             rel="stylesheet"
                                                //             type="text/css"
                                                //         />
                                                //     )
                                                //     : null
                                            }
                                        </Helmet>
                                        <NetworkErrorModal
                                            heading={
                                                (<Trans
                                                    i18nKey={ "common:networkErrorMessage.heading" }
                                                >
                                                    Your session has expired
                                                </Trans>)
                                            }
                                            description={
                                                (<Trans
                                                    i18nKey={ "common:networkErrorMessage.description" }
                                                >
                                                    Please try signing in again.
                                                </Trans>)
                                            }
                                            primaryActionText={
                                                (<Trans
                                                    i18nKey={
                                                        "common:networkErrorMessage.primaryActionText"
                                                    }
                                                >
                                                    Sign In
                                                </Trans>)
                                            }
                                            primaryAction={
                                                signOut
                                            }
                                        />
                                        <ChunkErrorModal
                                            heading={
                                                (<Trans
                                                    i18nKey={
                                                        "common:chunkLoadErrorMessage.heading"
                                                    }
                                                >
                                                    Something went wrong
                                                </Trans>)
                                            }
                                            description={
                                                (<Trans
                                                    i18nKey={
                                                        "common:chunkLoadErrorMessage.description"
                                                    }
                                                >
                                                    An error occurred when serving the requested
                                                    application. Please try reloading the app.
                                                </Trans>)
                                            }
                                            primaryActionText={
                                                (<Trans
                                                    i18nKey={
                                                        "common:chunkLoadErrorMessage.primaryActionText"
                                                    }
                                                >
                                                    Reload the App
                                                </Trans>)
                                            }
                                        />
                                        <Switch>
                                            <Redirect
                                                exact
                                                from="/"
                                                to={ AppConstants.getAppHomePath() }
                                            />
                                            {
                                                baseRoutes.map((route: RouteInterface, index: number) => {
                                                    return (
                                                        route.protected ?
                                                            (
                                                                <ProtectedRoute
                                                                    component={ route.component }
                                                                    path={ route.path }
                                                                    key={ index }
                                                                    exact={ route.exact }
                                                                />
                                                            )
                                                            :
                                                            (
                                                                <Route
                                                                    path={ route.path }
                                                                    render={
                                                                        (props:  RouteComponentProps<
                                                                            { [p: string]: string },
                                                                            StaticContext, unknown
                                                                        >) => {
                                                                            return (<route.component
                                                                                { ...props }
                                                                            />);
                                                                        }
                                                                    }
                                                                    key={ index }
                                                                    exact={ route.exact }
                                                                />
                                                            )
                                                    );
                                                })
                                            }
                                        </Switch>
                                    </>
                                </SessionManagementProvider>
                            </MediaContextProvider>
                        </Suspense>
                    </DocumentationProvider>
            </div>
        </Router>
    );
};

/**
 * A default export was added to support React.lazy.
 * TODO: Change this to a named export once react starts supporting named exports for code splitting.
 * @see {@link https://reactjs.org/docs/code-splitting.html#reactlazy}
 */
export default App;
