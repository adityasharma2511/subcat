import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
  BillingInterval,
} from "@shopify/shopify-app-remix/server";
import { MongoDBSessionStorage } from "@shopify/shopify-app-session-storage-mongodb";
import dbUtils from "./db.server.js";
import { BASIC_PLAN } from "./lib/constants.js";

// MongoDB connection details
const dbUrl = "mongodb+srv://adityaanilsharma00:adityaanil@cluster0.s2zhj.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const dbName = "shopify-app";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.January25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new MongoDBSessionStorage(dbUrl, dbName),
  distribution: AppDistribution.AppStore,
  future: {
    unstable_newAuthStrategy: "online",
    unstable_newEmbeddedAuthStrategy: true,
    removeRest: true,
  },
  hooks: {
    afterAuth: async ({session}) => {
      shopify.registerWebhooks({session});
    },
  },
  webhooks: {
    APP_UNINSTALLED: {
      deliveryMethod: "http",
      callbackUrl: "/webhooks/app/uninstalled",
    },
    APP_SUBSCRIPTIONS_UPDATE: {
      deliveryMethod: "http",
      callbackUrl: "/webhooks/app/subscription_update",
    },
  },
  billing: {
    [BASIC_PLAN]: {
      amount: 5.99,
      currencyCode: 'USD',
      interval: BillingInterval.Every30Days,
      trialDays: 7,
      test: true, // Always enable isTest for dev
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

console.log('Billing config:', {
  BASIC_PLAN,
  billing: {
    [BASIC_PLAN]: {
      amount: 5.99,
      currencyCode: 'USD',
      interval: 'Every30Days',
    },
  },
});

export default shopify;
export const apiVersion = ApiVersion.January25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;

// MongoDB helpers for billing tracking (optional, keep if you want to track subscriptions)
export async function saveOrUpdateBilling({ shop, planName, status, subscriptionId }) {
  const db = await dbUtils.getDB();
  const collection = db.collection("subscriptions");
  await collection.updateOne(
    { shop },
    { $set: { planName, status, subscriptionId, updatedAt: new Date() } },
    { upsert: true }
  );
}

export async function updateBillingStatus({ shop, status }) {
  const db = await dbUtils.getDB();
  const collection = db.collection("subscriptions");
  const result = await collection.updateOne(
    { shop },
    { $set: { status, updatedAt: new Date() } },
    { upsert: true }
  );
  console.log('Billing status updated:', { shop, status, result });
}
