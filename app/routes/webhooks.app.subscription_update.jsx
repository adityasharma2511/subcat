import { authenticate } from "../shopify.server";
import { MongoClient } from "mongodb";

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  const subscription = payload.app_subscription || payload.subscription || payload;
  const planName = subscription.name || subscription.plan_name || "unknown";
  const status = subscription.status || "unknown";
  const subscriptionId = subscription.id || subscription.admin_graphql_api_id;
  const now = new Date();

  const uri = "mongodb+srv://adityaanilsharma00:adityaanil@cluster0.s2zhj.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db("shopify-app");
    const collection = db.collection("subscriptions");

    const existing = await collection.findOne({ shop });

    if (status === "ACTIVE") {
      // Always upsert active plan
      const result = await collection.updateOne(
        { shop },
        {
          $set: { planName, status, subscriptionId, updatedAt: now },
          $setOnInsert: { shop, createdAt: now }
        },
        { upsert: true }
      );
      console.log(`[APP_SUBSCRIPTIONS_UPDATE] Active subscription saved for ${shop}`, result);
    }

    else if (status === "cancelled") {
      // Only update if not already active
      if (!existing || existing.status !== "active") {
        const result = await collection.updateOne(
          { shop },
          {
            $set: { planName, status, subscriptionId, updatedAt: now },
            $setOnInsert: { shop, createdAt: now }
          },
          { upsert: true }
        );
        console.log(`[APP_SUBSCRIPTIONS_UPDATE] Cancelled subscription updated for ${shop}`, result);
      } else {
        console.log(`[APP_SUBSCRIPTIONS_UPDATE] Skipped cancelling active plan for ${shop}`);
      }
    }

    else {
      console.log(`[APP_SUBSCRIPTIONS_UPDATE] Ignored unsupported status '${status}' for ${shop}`);
    }

  } catch (error) {
    console.error(`[APP_SUBSCRIPTIONS_UPDATE] Error for ${shop}:`, error);
  } finally {
    await client.close();
  }

  return new Response();
};

export default null;
