import { MongoClient } from "mongodb";

// MongoDB connection singleton
let client;
let db;

async function connectToDatabase() {
  if (!client) {
    // Use the provided MongoDB Atlas URI
    const uri = "mongodb+srv://adityaanilsharma00:adityaanil@cluster0.s2zhj.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
    client = new MongoClient(uri);
    await client.connect();
    // Select the database you want to use
    db = client.db("shopify-app");
    console.log("Connected to MongoDB Atlas");
  }
  return { client, db };
}

export default {
  connectToDatabase,
  getDB: async () => {
    const { db } = await connectToDatabase();
    return db;
  }
};
