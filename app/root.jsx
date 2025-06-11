import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
  useNavigation,
} from "@remix-run/react";
import { useEffect } from "react";
import NProgress from "nprogress";
import nProgressStyles from "./nprogress.css?url";

export const links = () => [
  { rel: "stylesheet", href: nProgressStyles },
];

export function ErrorBoundary() {
  const error = useRouteError();
  return (
    <html>
      <head>
        <title>Error</title>
        <Meta />
        <Links />
      </head>
      <body>
        <div>
          <h1>Error</h1>
          <p>{error.message || 'Unknown error occurred'}</p>
          {error.stack ? <pre>{error.stack}</pre> : null}
        </div>
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const navigation = useNavigation();

  useEffect(() => {
    if (navigation.state === "loading" || navigation.state === "submitting") {
      NProgress.start();
    } else {
      NProgress.done();
    }
  }, [navigation.state]);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
