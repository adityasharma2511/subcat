import * as Polaris from '@shopify/polaris';
const { Page, Card, Text } = Polaris;

export default function WidgetPage() {
  return (
    <Page title="Widget">
      <Card>
        <Text variant="bodyMd">
          This is the starting point for your Widget feature. Add your theme app extension block logic here.
        </Text>
      </Card>
    </Page>
  );
} 