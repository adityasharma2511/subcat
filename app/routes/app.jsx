import {
  Link,
  Outlet,
  useLoaderData,
  useRouteError,
  useNavigation,
} from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { Page, Spinner } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }) => {
  try {
    const { admin, session } = await authenticate.admin(request);
    
    return { 
      apiKey: process.env.SHOPIFY_API_KEY || "",
      shop: session?.shop || "" // Safely access shop with fallback
    };
  } catch (error) {
    // Let authentication redirects flow through
    if (error.status === 302) {
      throw error;
    }
    
    console.error("Authentication error:", error);
    throw error; // Throw other errors to be caught by the error boundary
  }
};

export default function App() {
  const { apiKey, shop } = useLoaderData();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";

  // Only render app content if we have the required props
  if (!apiKey) {
    return <div>Loading...</div>;
  }

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey} shop={shop}>
      <NavMenu>
        <Link to="/app" rel="home">
          Home
        </Link>
        <Link to="/app/products">Products</Link>
        <Link to="/app/dashboard">Collections</Link>
        <Link to="/app/widget">Widget</Link>
      </NavMenu>
      {isLoading ? (
        <Page>
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100vh'
          }}>
            <Spinner />
          </div>
        </Page>
      ) : (
        <Outlet />
      )}
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
