import {  redirect } from "@remix-run/node";
import { authenticate, updateBillingStatus } from "../shopify.server";
import { BASIC_PLAN } from "../lib/constants";

export const loader = async () => redirect("/app/pricing");

export const action = async ({ request }) => {
  const { billing, session } = await authenticate.admin(request);
  const billingCheck = await billing.require({
    plans: [BASIC_PLAN],
    onFailure: async () => billing.request({ plan: BASIC_PLAN }),
  });

  const subscription = billingCheck.appSubscriptions[0];
  await billing.cancel({
    subscriptionId: subscription.id,
    isTest: true,
    prorate: true,
   });

  // Update MongoDB subscription status for this shop
  const { shop } = session;
  await updateBillingStatus({ shop, status: "cancelled" });

  // App logic
   return redirect("/app/pricing");
};
