import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);
  
  // Get query from URL
  const url = new URL(request.url);
  const query = url.searchParams.get("query") || "";
  
  try {
    // Search for products matching the query (or fetch all if query is empty)
    const response = await admin.graphql(
      `#graphql
      query SearchProducts($query: String, $first: Int!) {
        products(first: $first, query: $query) {
          edges {
            node {
              id
              title
              handle
              featuredImage {
                url
                altText
              }
              status
              vendor
              productType
              tags
              createdAt
              priceRangeV2 {
                minVariantPrice {
                  amount
                  currencyCode
                }
                maxVariantPrice {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }`,
      {
        variables: {
          query: query.trim(),
          first: 50, // Increased to get more products when browsing
        },
      }
    );

    const responseJson = await response.json();

    if (!responseJson.data || !responseJson.data.products) {
      return json({
        products: []
      });
    }
    
    const products = responseJson.data.products.edges.map(edge => edge.node);

    return json({
      products
    });
  } catch (error) {
    console.error("Error searching products:", error);
    return json({
      products: [],
      error: error.message
    }, { status: 500 });
  }
} 