import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export async function loader({ request, params }) {
  const { admin } = await authenticate.admin(request);
  const { collectionId } = params;
  
  try {
    // Fetch all collections
    const response = await admin.graphql(
      `#graphql
      query GetAllCollections {
        collections(first: 100) {
          edges {
            node {
              id
              title
              handle
              image {
                url
              }
            }
          }
        }
      }`
    );
    
    const responseJson = await response.json();
    const collections = responseJson.data.collections.edges.map(edge => edge.node);
    
    // Filter out the current collection
    const filteredCollections = collections.filter(c => 
      c.id !== `gid://shopify/Collection/${collectionId}`
    );
    
    return json({
      collections: filteredCollections
    });
  } catch (error) {
    console.error("Error fetching collections:", error);
    return json({
      error: "Error fetching collections: " + error.message,
      collections: []
    }, { status: 500 });
  }
} 