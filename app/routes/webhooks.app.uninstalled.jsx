import { authenticate } from "../shopify.server";
import { MongoClient } from "mongodb";

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Connect to the Sessions database and delete the store's session(s)
  const uri = "mongodb+srv://adityaanilsharma00:adityaanil@cluster0.s2zhj.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db("shopify-app");
    const result = await db.collection("shopify_sessions").deleteMany({ shop });
    console.log(`Deleted ${result.deletedCount} session(s) for shop: ${shop}`);
  } catch (err) {
    console.error(`Error deleting shopify_sessions for ${shop}:`, err);
  } finally {
    await client.close();
  }

  return new Response();
};
