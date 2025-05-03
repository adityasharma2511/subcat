import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const query = url.searchParams.get("query") || "";

  try {
    const response = await admin.graphql(`
      query {
        products(first: 50, query: "${query}") {
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
              }
            }
          }
        }
      }
    `);

    const data = await response.json();
    const products = data.data.products.edges.map(({ node }) => node);

    return json({ products });
  } catch (error) {
    console.error("Error searching products:", error);
    return json({
      products: [],
      error: error.message
    }, { status: 500 });
  }
}; 