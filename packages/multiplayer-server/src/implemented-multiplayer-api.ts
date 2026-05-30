import {
    createMultiplayerRoomHandler,
    multiplayerApi,
    multiplayerConnectWebSocket,
    multiplayerHealthEndpoint,
    multiplayerRoomsEndpoint,
    multiplayerRootEndpoint,
    type MultiplayerRoomHandler,
} from '@antha/multiplayer-core';
import {check} from '@augment-vir/assert';
import {callAsynchronously, ensureArray, type PartialWithUndefined} from '@augment-vir/common';
import {
    AnyOrigin,
    checkOriginRequirement,
    HttpMethod,
    HttpStatus,
    type BaseSearchParams,
    type OriginRequirement,
} from '@rest-vir/api';
import {
    createApiImplementor,
    defaultServerLogger,
    implementApi,
    silentServerLogger,
    type ServerLogger,
} from '@rest-vir/host';
import {type RequireAtLeastOne} from 'type-fest';

/**
 * Multiplayer server options.
 *
 * @category Internal
 */
export type MultiplayerServerOptions = PartialWithUndefined<{
    /**
     * The Multiplayer server's logger.
     *
     * For help setting this, see any of the following from `@rest-vir/host`:
     *
     * - `silentServerLogger`
     * - `defaultServerLogger`
     * - `createServerLogger`
     */
    logger: ServerLogger;
    backendOrigin: string;
}> & {
    games: RequireAtLeastOne<{
        /**
         * Allow specific games by id. If a game id is not matched, the below `default` requirement
         * is checked. If no game id is matched and there is no specified `default` requirement, the
         * request is blocked.
         *
         * If a game id's origin requirement is `undefined`, it is not considered a match.
         */
        byId: {
            [GameId in string]: OriginRequirement;
        };
        /**
         * The default requirement for all unmatched game ids. If this is omitted or `undefined`,
         * all unmatched game ids are blocked.
         */
        default: OriginRequirement;
    }>;
};

/**
 * Internal state for the multiplayer server.
 *
 * @category Internal
 */
export type MultiplayerServerState = {
    roomHandler: MultiplayerRoomHandler;
    logger: ServerLogger;
};

/**
 * The default logger for {@link ImplementedMultiplayerApi}.
 *
 * @category Internal
 */
export const defaultMultiplayerApiLogger: ServerLogger = {
    error: defaultServerLogger.error,
    info: silentServerLogger.info,
};

type MultiplayerHostContext = {
    gameId: string;
};

/**
 * The implemented API returned from {@link implementMultiplayerApi}.
 *
 * @category Internal
 */
export type ImplementedMultiplayerApi = ReturnType<typeof implementMultiplayerApi>['api'];

/**
 * Implements the multiplayer API.
 *
 * @category Internal
 */
export function implementMultiplayerApi(options: MultiplayerServerOptions) {
    const logger = options.logger || defaultMultiplayerApiLogger;
    const roomHandler = createMultiplayerRoomHandler({
        logger,
    });

    const serverState: MultiplayerServerState = {
        roomHandler,
        logger,
    };
    const implementor = createApiImplementor<MultiplayerHostContext>()(multiplayerApi);

    const api = implementApi<MultiplayerHostContext>()(multiplayerApi, {
        serverLogger: serverState.logger,
        clientOriginRequirement: AnyOrigin,
        async createHostContext({
            searchParams,
            endpointDefinition,
            webSocketDefinition,
            requestHeaders,
        }) {
            const definition = endpointDefinition || webSocketDefinition;

            if (!definition) {
                return {
                    reject: {
                        statusCode: HttpStatus.NotFound,
                    },
                };
            } else if (
                multiplayerRootEndpoint.path === definition.path ||
                multiplayerHealthEndpoint.path === definition.path
            ) {
                return {
                    context: {
                        gameId: '',
                    },
                };
            }

            const gameId = extractGameId(searchParams);
            const originRequirement =
                check.isString(gameId) && gameId
                    ? options.games.byId?.[gameId] || options.games.default
                    : undefined;

            if (!check.isString(gameId) || !gameId) {
                serverState.logger.error(new TypeError(`Invalid game ID: '${gameId}'`));
                return {
                    reject: {
                        statusCode: HttpStatus.Unauthorized,
                    },
                };
            } else if (
                !(await checkOriginRequirement(extractOrigin(requestHeaders), originRequirement))
            ) {
                serverState.logger.error(
                    new TypeError(`Origin check failed for game: '${gameId}'`),
                );
                return {
                    reject: {
                        statusCode: HttpStatus.Unauthorized,
                    },
                };
            }

            return {
                context: {
                    gameId,
                },
            };
        },
        endpoints: [
            implementor.implementEndpoint(multiplayerRootEndpoint, {
                [HttpMethod.Get]() {
                    return {
                        [HttpStatus.Ok]: {
                            responseData: 'ok',
                        },
                    };
                },
            }),
            implementor.implementEndpoint(multiplayerHealthEndpoint, {
                [HttpMethod.Get]() {
                    return {
                        [HttpStatus.Ok]: {
                            responseData: 'ok',
                        },
                    };
                },
            }),
            implementor.implementEndpoint(multiplayerRoomsEndpoint, {
                [HttpMethod.Get]({context}) {
                    return {
                        [HttpStatus.Ok]: {
                            responseData: roomHandler.getRoomsForFetching(context.gameId),
                        },
                    };
                },
            }),
        ],
        webSockets: [
            implementor.implementWebSocket(multiplayerConnectWebSocket, {
                message({message, webSocket, context}) {
                    roomHandler.enqueueMessage({
                        gameId: context.gameId,
                        message,
                        transport: webSocket,
                    });
                    void callAsynchronously(() => roomHandler.processQueue());
                },
                close({context}) {
                    roomHandler.updateRoomsForFetching(context.gameId);
                },
            }),
        ],
    });

    return {
        serverState,
        api,
    };
}

function extractGameId({gameId}: Readonly<BaseSearchParams>): string | undefined {
    const firstGameId = ensureArray(gameId)[0];

    return check.isString(firstGameId) ? firstGameId : undefined;
}

function extractOrigin({
    origin,
}: Readonly<Record<string, string | string[] | undefined>>): string | undefined {
    const firstOrigin = ensureArray(origin)[0];

    return check.isString(firstOrigin) ? firstOrigin : undefined;
}
