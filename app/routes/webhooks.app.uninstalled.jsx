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
    // Improved upsert: set status/updatedAt always, set shop/createdAt only if new
    const subResult = await db.collection("subscriptions").updateOne(
      { shop },
      {
        $set: { status: "cancelled", updatedAt: new Date() },
        $setOnInsert: { shop, createdAt: new Date() }
      },
      { upsert: true }
    );
    console.log(`Subscription status set to 'cancelled' for shop: ${shop}`, subResult);
  } catch (err) {
    console.error(`Error handling uninstall for ${shop}:`, err);
  } finally {
    await client.close();
  }

  return new Response();
};
