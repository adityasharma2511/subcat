import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  Button,
  BlockStack,
  Banner,
} from "@shopify/polaris";

// Loader: all server-only code is here
export const loader = async ({ request }) => {
  // Import server-only code inside the loader
  const { authenticate } = await import("../shopify.server.js");
  const { admin, billing } = await authenticate.admin(request);
  let confirmationUrl = null;
  let hasActiveSubscription = false;
  let subscription = null;
  let error = null;
  let plans = [];

  // Fetch all subscription plans from Shopify Admin GraphQL API using admin.graphql
  try {
    const plansResponse = await admin.graphql(
      `#graphql
      query GetSubscriptionPlans {
        app {
          subscriptionPlans(first: 10) {
            edges {
              node {
                id
                name
                pricingDetails {
                  __typename
                  ... on AppRecurringPricing {
                    price {
                      amount
                      currencyCode
                    }
                    interval
                  }
                }
                trialDays
                test
              }
            }
          }
        }
      }`
    );
    const data = await plansResponse.json();
    console.log("Shopify plans API response:", JSON.stringify(data, null, 2));
    plans = data?.data?.app?.subscriptionPlans?.edges?.map(edge => edge.node) || [];
  } catch (e) {
    error = "Failed to fetch plans from Shopify.";
  }

  // Optionally, you can still check for active subscriptions as before (using the first plan as default)
  const planNames = plans.map(p => p.name);
  try {
    if (planNames.length > 0) {
      const billingCheck = await billing.require({
        plans: planNames,
        isTest: process.env.NODE_ENV !== "production",
        onFailure: () => {},
      });
      if (billingCheck && billingCheck.appSubscriptions && billingCheck.appSubscriptions.length > 0) {
        hasActiveSubscription = true;
        subscription = billingCheck.appSubscriptions[0];
      } else if (billingCheck && billingCheck.confirmationUrl) {
        confirmationUrl = billingCheck.confirmationUrl;
      }
    }
  } catch (e) {
    if (e && typeof e === "object" && "confirmationUrl" in e && e.confirmationUrl) {
      confirmationUrl = e.confirmationUrl;
    } else {
      error = (e && typeof e === "object" && "message" in e) ? e.message : "An error occurred while checking billing.";
    }
  }

  return json({ plans, confirmationUrl, hasActiveSubscription, subscription, error });
};

export default function Pricing() {
  const { plans, confirmationUrl, hasActiveSubscription, subscription, error } = useLoaderData();

  return (
    <Page title="App Pricing">
      <BlockStack gap="400">
        <Text variant="heading2xl" as="h1" alignment="center">
          Choose Your Plan
        </Text>
        {plans && plans.length > 0 ? (
          plans.map((plan) => (
            <Card sectioned key={plan.id}>
              <BlockStack gap="200">
                <Text variant="headingLg" as="h2">{plan.name}</Text>
                <Text variant="bodyMd">{plan.test ? "Test plan" : ""}</Text>
                {plan.pricingDetails && plan.pricingDetails.__typename === "AppRecurringPricing" && (
                  <Text variant="heading2xl" as="p" tone="success">
                    ${plan.pricingDetails.price.amount} {plan.pricingDetails.price.currencyCode} <Text variant="bodyMd" as="span">/ {plan.pricingDetails.interval}</Text>
                  </Text>
                )}
                <Text variant="bodySm" tone="subdued">Includes a {plan.trialDays}-day free trial</Text>
                {hasActiveSubscription ? (
                  <Banner status="success" title="You are subscribed!">
                    <p>Your subscription is active. Thank you for being a valued customer.</p>
                    {subscription && (
                      <>
                        <Text variant="bodySm">Plan: {subscription.name}</Text><br/>
                        <Text variant="bodySm">Status: {subscription.status}</Text>
                      </>
                    )}
                  </Banner>
                ) : confirmationUrl ? (
                  <Button
                    primary
                    size="large"
                    onClick={() => window.location.assign(confirmationUrl)}
                  >
                    Start Free Trial
                  </Button>
                ) : error ? (
                  <Banner status="critical" title="Error">
                    <p>{error}</p>
                  </Banner>
                ) : null}
              </BlockStack>
            </Card>
          ))
        ) : (
          <Banner status="info" title="No plans found">
            <p>No subscription plans are currently available.</p>
          </Banner>
        )}
        <Card sectioned subdued>
          <Text variant="bodySm" tone="subdued">
            Powered by Shopify Billing. You can manage your subscription anytime in your Shopify Admin.<br/>
            <a href="https://shopify.dev/docs/apps/launch/billing" target="_blank" rel="noopener noreferrer">Learn more about Shopify app billing</a>
          </Text>
        </Card>
      </BlockStack>
    </Page>
  );
} 