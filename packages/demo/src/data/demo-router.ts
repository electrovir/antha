import {mapObject} from '@augment-vir/common';
import {PathTree, SpaRouter, type FullSpaRoute, type SpaRouteByPath} from 'spa-router-vir';

export const demoPathTree = new PathTree({
    allowBare: true,
    children: {
        ':demo-id': {
            anyChildren: true,
        },
    },
});

export type DemoRoutePaths = Readonly<typeof demoPathTree.PathsType>;
export type DemoRoute<Paths extends ReadonlyArray<string> | void = void> =
    Paths extends DemoRoutePaths
        ? SpaRouteByPath<Paths, Readonly<FullSpaRoute<DemoRoutePaths, DemoRouteSearchParams>>>
        : Readonly<FullSpaRoute<DemoRoutePaths, DemoRouteSearchParams>>;

export const testNameSearchParamKey = 'testName';

export type DemoRouteSearchParams =
    | Partial<{
          /** Used in tests, we want to make sure we don't clear it otherwise tests won't work. */
          'wtr-session-id': Readonly<[string]>;
      }>
    | undefined;

export type DemoRouteSearchParamsKey = keyof NonNullable<DemoRouteSearchParams>;

export const defaultDemoRoute: DemoRoute = {
    paths: demoPathTree.paths.fullPaths,
    hash: undefined,
    search: undefined,
};

function sanitizeSearch(
    route: Readonly<FullSpaRoute<DemoRoutePaths, any, any>>,
): DemoRouteSearchParams {
    const search = route.search as Record<string, string[] | undefined> | undefined;

    if (!search) {
        return undefined;
    }

    const enabledSearchParamKeys: Record<DemoRouteSearchParamsKey, boolean> = {
        'wtr-session-id': true,
    };

    return mapObject(enabledSearchParamKeys, (key, enabled) => {
        const rawValue = route.search[key]?.[0];
        if (!enabled || !rawValue) {
            return undefined;
        }

        return {
            key,
            value: [rawValue] as const,
        };
    });
}

export type DemoRouter = SpaRouter<DemoRoutePaths, DemoRouteSearchParams, string | undefined>;

export function createDemoRouter() {
    return new SpaRouter({
        sanitizeRoute(rawRoute) {
            const sanitizedPaths = demoPathTree.sanitizePaths(rawRoute.paths);

            return {
                hash: rawRoute.hash,
                paths: sanitizedPaths,
                search: sanitizeSearch({
                    ...rawRoute,
                    paths: sanitizedPaths,
                }),
            };
        },
    });
}
