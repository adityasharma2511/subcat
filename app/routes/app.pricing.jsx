import {
  Page,
  Box,
  Button,
  Card,
  CalloutCard,
  Text,
  Grid,
  Divider,
  BlockStack,
  ExceptionList,
  ChoiceList,
  Badge
} from "@shopify/polaris";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit } from "@remix-run/react";
import { BASIC_PLAN } from "../lib/constants";
import { authenticate } from "../shopify.server";
import { useState } from "react";

import {
  MobileIcon
} from '@shopify/polaris-icons'

export async function loader({ request }) {
  const { billing } = await authenticate.admin(request);

  try {
    // Attempt to check if the shop has an active payment for the basic plan
    const billingCheck = await billing.require({
      plans: [BASIC_PLAN],
      isTest: true,
      onFailure: () => {
        throw new Error('No active plan');
      },
    });

    // If the shop has an active subscription, log and return the details
    const subscription = billingCheck.appSubscriptions[0];
    console.log(`Shop is on ${subscription.name} (id ${subscription.id})`);
    return json({ billing, plan: subscription });

  } catch (error) {
    // If the shop does not have an active plan, return an empty plan object
    if (error.message === 'No active plan') {
      console.log('Shop does not have any active plans.');
      return json({ billing, plan: { name: "none" } });
    }
    // If there is another error, rethrow it
    throw error;
  }
}

const basicPlan = {
  name: BASIC_PLAN,
  label: "Basic Plan",
  price: 5.99,
  interval: "Every 30 days",
  trialDays: 7,
  currency: "USD",
  title: "Basic Plan",
  description: "Access all essential features for growing your business.",
  features: [
    "Create Unlimited Subcategories",
    "Manage subcategories With Clean UI",
    "Drag & Drop To Reorder Subcategories",
    "Add Smart Subcategory Widget",
    "Fully Customizable Widget",
    "Built For Merchant",
    "Works With 2.0 Dawn Theme",
  ],
  action: "Upgrade to Basic",
  url: "/app/upgrade",
};

export default function PricingPage() {
  const { plan } = useLoaderData();
  const isOnBasic = plan?.name?.toLowerCase() === "basic";
  const submit = useSubmit();

  const handleUpgrade = (e) => {
    e.preventDefault();
    submit(null, { method: "post", action: basicPlan.url });
  };

  return (
    <Page>
      <ui-title-bar title="Pricing" />
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ flex: 1 }}>
            <Text as="h2" variant="headingMd" fontWeight="bold">Your Plan</Text>
            <Text as="p" variant="bodyMd">
              You do not have an active plan. Upgrade to the <b>Basic Plan</b> to unlock all features.
            </Text>
          </div>
          <img
            src="https://cdn.shopify.com/s/files/1/0583/6465/7734/files/tag.png?v=1705280535"
            alt="Pricing illustration"
            style={{ width: 80, height: 80, marginLeft: 24 }}
          />
        </div>
      </Card>

      <div style={{ margin: "0.5rem 0"}}>
        <Divider />
      </div>

      <Grid>
        <Grid.Cell columnSpan={{xs: 6, sm: 3, md: 3, lg: 6, xl: 6}}>
          <Card background={ isOnBasic ? "bg-surface-success" : "bg-surface" } sectioned>
            <Box padding="400">
              <Text as="h3" variant="headingMd">
                {basicPlan.title}
              </Text>
              <Box as="p" variant="bodyMd">
                {basicPlan.description}
              </Box>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0' }}>
                <Text as="span" variant="headingLg" fontWeight="bold">
                  ${basicPlan.price}
                </Text>
                <Text as="span" variant="bodyMd" color="subdued"> /month</Text>
              </div>
              <Text as="p" variant="bodySm" color="subdued">Billed monthly. Cancel anytime.</Text>
              <div style={{ margin: "0.5rem 0"}}>
                <Divider />
              </div>
              <ul style={{ paddingLeft: 20, margin: 0 }}>
                {basicPlan.features.map((feature, index) => (
                  <li key={index} style={{ marginBottom: 8, fontSize: 13}}>
                    {feature}
                  </li>
                ))}
              </ul>
              <div style={{ margin: "0.5rem 0"}}>
                <Divider />
              </div>
              {isOnBasic ? (
                <Text as="p" variant="bodyMd">
                  You're currently on this plan
                </Text>
              ) : (
                <form onSubmit={handleUpgrade}>
                  <Button
                  variant="primary"
                    submit
                    fullWidth
                    style={{ background: '#000', color: '#fff', fontWeight: 600, fontSize: 16 }}
                  >
                    {basicPlan.action}
                  </Button>
                </form>
              )}
            </Box>
          </Card>
        </Grid.Cell>
      </Grid>
    </Page>
  );
}

