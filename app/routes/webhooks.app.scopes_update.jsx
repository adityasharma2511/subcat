import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { payload, topic, shop } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  const current = payload.current;

  try {
    // Get the database instance
    const database = await db.getDB();
    
    // Update session scopes in the database
    const result = await database.collection("sessions").updateMany(
      { shop },
      { $set: { scope: current.toString() } }
    );
    
    console.log(`Updated ${result.modifiedCount} session(s) for ${shop}`);
    
    return new Response(null, { status: 200 });
  } catch (error) {
    console.error(`Error handling ${topic} webhook:`, error);
    return new Response(null, { status: 500 });
  }
};
