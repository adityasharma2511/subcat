import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
  useNavigation,
  useLoaderData,
} from "@remix-run/react";
import { json } from "@remix-run/node";
import { useEffect } from "react";
import NProgress from "nprogress";
import nProgressStyles from "./nprogress.css?url";
import { AppProvider } from "@shopify/shopify-app-remix/react";

export const links = () => [
  { rel: "stylesheet", href: nProgressStyles },
];

export const loader = () => {
  return json({ apiKey: process.env.SHOPIFY_API_KEY });
};

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
  const { apiKey } = useLoaderData();

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
        <AppProvider apiKey={apiKey} isEmbeddedApp>
          <Outlet />
        </AppProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
