export const action = async ({ request }) => {
  const { redirect } = await import("@remix-run/node");
  const { authenticate, saveOrUpdateBilling } = await import("../shopify.server");
  const { BASIC_PLAN } = await import("../lib/constants");

  const { billing, session } = await authenticate.admin(request);
  let { shop } = session;
  let myShop = shop.replace(".myshopify.com", "");

  let planRequest = {
    plan: BASIC_PLAN,
    isTest: true,
    returnUrl: `https://admin.shopify.com/store/${myShop}/apps/am-collection-tree/app/pricing`,
  };

  const result = await billing.request(planRequest);

  // Redirect the merchant to the Shopify confirmation page
  await saveOrUpdateBilling({
    shop,
    planName: BASIC_PLAN,
    status: "active",
    subscriptionId: subscription.id,
  });

  return redirect(result.confirmationUrl);
};

export const loader = async () => {
  const { redirect } = await import("@remix-run/node");
  return redirect("/app/pricing");
};

export default null;
