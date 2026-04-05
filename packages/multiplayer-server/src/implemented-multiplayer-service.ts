import {
    createMultiplayerRoomHandler,
    defineMultiplayerService,
    type MultiplayerRoomHandler,
} from '@antha/multiplayer-core';
import {check} from '@augment-vir/assert';
import {callAsynchronously, type PartialWithUndefined} from '@augment-vir/common';
import {checkOriginRequirement, type OriginRequirement} from '@rest-vir/define-service';
import {
    defaultServiceLogger,
    HttpStatus,
    implementService,
    silentServiceLogger,
    type ServiceLogger,
} from '@rest-vir/implement-service';
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
     * For help setting this, see any of the following from `@rest-vir/implement-service':
     *
     * - `silentServiceLogger`
     * - `defaultServiceLogger`
     * - `createServiceLogger`
     */
    logger: ServiceLogger;
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
    logger: ServiceLogger;
};

/**
 * The default logger for {@link ImplementedMultiplayerService}.
 *
 * @category Internal
 */
export const defaultMultiplayerServiceLogger: ServiceLogger = {
    error: defaultServiceLogger.error,
    info: silentServiceLogger.info,
};

/**
 * The implemented service returned from {@link implementMultiplayerService}.
 *
 * @category Internal
 */
export type ImplementedMultiplayerService = ReturnType<
    typeof implementMultiplayerService
>['service'];

/**
 * Implements the multiplayer server.
 *
 * @category Internal
 */
export function implementMultiplayerService(options: MultiplayerServerOptions) {
    const logger = options.logger || defaultMultiplayerServiceLogger;
    const roomHandler = createMultiplayerRoomHandler({
        logger,
    });

    const serverState: MultiplayerServerState = {
        roomHandler,
        logger,
    };
    const serviceDefinition = defineMultiplayerService(options.backendOrigin);

    const service = implementService({
        service: serviceDefinition,
        logger: serverState.logger,
        async createContext({
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
                serviceDefinition.endpoints['/'].path === definition.path ||
                serviceDefinition.endpoints['/health'].path === definition.path
            ) {
                return {
                    context: {
                        gameId: '',
                    },
                };
            }

            const gameId = 'gameId' in searchParams ? searchParams.gameId[0] : undefined;
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
            } else if (!(await checkOriginRequirement(requestHeaders.origin, originRequirement))) {
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
    })({
        endpoints: {
            '/'() {
                return {
                    statusCode: HttpStatus.Ok,
                    responseData: 'ok',
                };
            },
            '/health'() {
                return {
                    statusCode: HttpStatus.Ok,
                    responseData: 'ok',
                };
            },
            '/rooms'({context}) {
                return {
                    statusCode: HttpStatus.Ok,
                    responseData: roomHandler.getRoomsForFetching(context.gameId),
                };
            },
        },
        webSockets: {
            '/connect': {
                message({message, webSocket, context}) {
                    roomHandler.enqueueMessage({
                        gameId: context.gameId,
                        message,
                        transport: webSocket,
                    });
                    void callAsynchronously(() => roomHandler.processQueue());
                },
            },
        },
    });

    return {
        serverState,
        service,
    };
}
