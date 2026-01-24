import type {AppConfig} from '../config/config';

type Handler = (req: Request, cfg: AppConfig, url: URL) => Promise<Response> | Response;

type Route = {
    method: string;
    path: string | RegExp;
    handler: Handler;
};

export class Router {
    private routes: Route[] = [];

    get(path: string | RegExp, handler: Handler) {
        this.add('GET', path, handler);
    }

    post(path: string | RegExp, handler: Handler) {
        this.add('POST', path, handler);
    }

    options(path: string | RegExp, handler: Handler) {
        this.add('OPTIONS', path, handler);
    }

    private add(method: string, path: string | RegExp, handler: Handler) {
        this.routes.push({method, path, handler});
    }

    async handle(req: Request, cfg: AppConfig): Promise<Response | null> {
        const url = new URL(req.url);

        for (const route of this.routes) {
            if (req.method !== route.method) continue;

            let match = false;
            if (typeof route.path === 'string') {
                match = url.pathname === route.path;
            } else {
                match = route.path.test(url.pathname);
            }

            if (match) {
                return route.handler(req, cfg, url);
            }
        }

        return null;
    }
}
