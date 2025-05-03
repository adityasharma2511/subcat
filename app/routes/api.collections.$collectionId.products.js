import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export async function loader({ request, params }) {
  const { admin } = await authenticate.admin(request);
  const { collectionId } = params;
  
  // Get cursor from query parameters
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  
  try {
    const response = await admin.graphql(
      `#graphql
      query GetCollectionProducts($id: ID!, $first: Int!, $after: String) {
        collection(id: $id) {
          products(first: $first, after: $after) {
            edges {
              node {
                id
                title
                handle
                featuredImage {
                  url
                  altText
                }
                vendor
                productType
              }
              cursor
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }`,
      {
        variables: {
          id: `gid://shopify/Collection/${collectionId}`,
          first: 20,
          after: cursor || null,
        },
      }
    );

    const responseJson = await response.json();
    
    if (!responseJson.data || !responseJson.data.collection) {
      return json({
        products: [],
        pageInfo: { hasNextPage: false, endCursor: null },
        error: "Collection not found"
      }, { status: 404 });
    }
    
    const products = responseJson.data.collection.products.edges.map(edge => edge.node);
    const pageInfo = responseJson.data.collection.products.pageInfo;

    return json({
      products,
      pageInfo
    });
    
  } catch (error) {
    console.error("Error fetching collection products:", error);
    return json({
      products: [],
      pageInfo: { hasNextPage: false, endCursor: null },
      error: error.message
    }, { status: 500 });
  }
} 