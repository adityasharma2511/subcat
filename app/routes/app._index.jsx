import { useState, useCallback, useEffect } from "react";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useLocation, useSubmit, useActionData, useNavigation } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { ChevronDownIcon, ChevronUpIcon, EditIcon, PlusIcon, MinusIcon } from "@shopify/polaris-icons";
import {
  Page,
  Layout,
  Card,
  Text,
  ResourceList,
  ResourceItem,
  Button,
  InlineStack,
  BlockStack,
  Box,
  Divider,
  Thumbnail,
  Badge,
  EmptyState,
  Collapsible,
  Form,
  FormLayout,
  Spinner,
  Banner,
  Modal,
  TextField,
  Select,
  List,
  RadioButton,
} from "@shopify/polaris";
import CollectionImageUpload from '../components/CollectionImageUpload';

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  
  try {
    // Fetch all collections with their subcategory metafields
    const collectionsResponse = await admin.graphql(
      `#graphql
      query GetCollectionsWithSubcategories {
        collections(first: 100, query: "parent_collection_id:null") {
          edges {
            node {
              id
              title
              handle
              image {
                url
              }
              metafields(first: 10, namespace: "custom") {
                edges {
                  node {
                    id
                    namespace
                    key
                    type
                    value
                    references(first: 50) {
                      edges {
                        node {
                          ... on Collection {
                            id
                            title
                            handle
                            image {
                              url
                            }
                            productsCount {
                              count
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
              productsCount {
                count
              }
            }
          }
        }
      }`
    );

    const collectionsJson = await collectionsResponse.json();
    
    // Extract and process the collections data
    const collections = collectionsJson.data.collections.edges.map(edge => {
      const collection = edge.node;
      
      // Find subcategories metafield
      const subcategoriesMetafield = collection.metafields.edges.find(
        metaEdge => metaEdge.node.namespace === "custom" && metaEdge.node.key === "subcat"
      );
      
      // Extract subcategories if they exist
      let subcategories = [];
      if (subcategoriesMetafield && subcategoriesMetafield.node.references) {
        subcategories = subcategoriesMetafield.node.references.edges.map(refEdge => refEdge.node);
      }
      
      return {
        ...collection,
        subcategories,
        subcategoriesCount: subcategories.length,
      };
    });
    
    return json({
      collections,
      error: null
    });
  } catch (error) {
    console.error("Error fetching collections:", error);
    return json({
      collections: [],
      error: "Failed to load collections. Please try again."
    });
  }
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action");

  if (action === "refresh_data") {
    return json({ success: true });
  }

  if (action === "create_collection") {
    const title = formData.get("title");
    const description = formData.get("description");
    const imageUrl = formData.get("imageUrl");
    const collectionType = formData.get("collectionType");
    const ruleSet = formData.get("ruleSet");
    const collectionInput = {
      title,
      descriptionHtml: description
    };
    if (imageUrl && imageUrl.trim() !== "") {
      collectionInput.image = { src: imageUrl };
    }
    if (collectionType === "SMART" && ruleSet) {
      collectionInput.ruleSet = JSON.parse(ruleSet);
    }
    // Step 1: Create the collection
    const response = await admin.graphql(
      `#graphql
      mutation createCollection($input: CollectionInput!) {
        collectionCreate(input: $input) {
          collection { id title handle image { url } }
          userErrors { field message }
        }
      }`,
      { variables: { input: collectionInput } }
    );
    const responseJson = await response.json();
    if (responseJson.data?.collectionCreate?.userErrors?.length > 0) {
      return json({
        success: false,
        errors: responseJson.data.collectionCreate.userErrors
      });
    }
    const newCollection = responseJson.data.collectionCreate.collection;
    let publicationResult = null;
    let onlineStorePublicationId = null;
    let publishError = null;
    // Step 2: Dynamically fetch Online Store publicationId
    try {
      const publicationsResp = await admin.graphql(
        `#graphql
        query GetPublications {
          publications(first: 10) {
            edges { node { id name } }
          }
        }`
      );
      const publicationsJson = await publicationsResp.json();
      const onlineStorePublication = (publicationsJson.data.publications.edges || []).find(
        edge => edge.node.name === "Online Store"
      );
      onlineStorePublicationId = onlineStorePublication?.node?.id || null;
      if (!onlineStorePublicationId) {
        publishError = "Online Store publicationId not found.";
        console.error("[DEBUG] Online Store publicationId not found.");
      }
    } catch (err) {
      publishError = err.message;
      console.error("[DEBUG] Error fetching publications:", err);
    }
    // Step 3: Publish the collection if possible
    if (onlineStorePublicationId && newCollection?.id) {
      try {
        const publishResp = await admin.graphql(
          `#graphql
          mutation publishCollection($id: ID!, $publicationId: ID!) {
            publishablePublish(id: $id, input: [{ publicationId: $publicationId }]) {
              publishable {
                publishedOnPublication(publicationId: $publicationId)
              }
              userErrors { field message }
            }
          }`,
          {
            variables: {
              id: newCollection.id,
              publicationId: onlineStorePublicationId
            }
          }
        );
        const publishJson = await publishResp.json();
        publicationResult = publishJson.data.publishablePublish;
        if (publishJson.data.publishablePublish.userErrors?.length > 0) {
          publishError = publishJson.data.publishablePublish.userErrors.map(e => e.message).join(", ");
          console.error("[DEBUG] Publish userErrors:", publishJson.data.publishablePublish.userErrors);
        } else {
          console.log(`[DEBUG] Collection published to Online Store. publicationId: ${onlineStorePublicationId}`);
        }
      } catch (err) {
        publishError = err.message;
        console.error("[DEBUG] Error publishing collection:", err);
      }
    }
    // Step 4: Return result with debug info
    if (publishError) {
      return json({
        success: true,
        message: "Collection created, but publication to Online Store failed: " + publishError,
        publicationId: onlineStorePublicationId,
        debug: publicationResult
      });
    }
    return json({
      success: true,
      message: "Collection created and published to Online Store.",
      publicationId: onlineStorePublicationId,
      debug: publicationResult
    });
  }

  if (action === "create_subcategory") {
    const title = formData.get("title");
    const description = formData.get("description") || "";
    const imageUrl = formData.get("imageUrl") || "";
    const parentId = formData.get("parentId");
    const subcatType = formData.get("subcatType");
    const ruleSet = formData.get("ruleSet");
    if (!title || !parentId || !subcatType) {
      return json({ success: false, message: "Subcategory title, parent, and type are required" });
    }
    const collectionInput = { title, descriptionHtml: description };
    if (imageUrl && imageUrl.trim() !== "") {
      collectionInput.image = { src: imageUrl };
    }
    if (subcatType === "SMART" && ruleSet) {
      collectionInput.ruleSet = JSON.parse(ruleSet);
    }
    const response = await admin.graphql(
      `#graphql
      mutation createCollection($input: CollectionInput!) {
        collectionCreate(input: $input) {
          collection { id title handle image { url } }
          userErrors { field message }
        }
      }`,
      { variables: { input: collectionInput } }
    );
    const responseJson = await response.json();
    if (responseJson.data?.collectionCreate?.userErrors?.length > 0) {
      return json({
        success: false,
        errors: responseJson.data.collectionCreate.userErrors
      });
    }
    const newSubcat = responseJson.data.collectionCreate.collection;
    let publicationResult = null;
    let onlineStorePublicationId = null;
    let publishError = null;
    // Step 2: Dynamically fetch Online Store publicationId
    try {
      const publicationsResp = await admin.graphql(
        `#graphql
        query GetPublications {
          publications(first: 10) {
            edges { node { id name } }
          }
        }`
      );
      const publicationsJson = await publicationsResp.json();
      const onlineStorePublication = (publicationsJson.data.publications.edges || []).find(
        edge => edge.node.name === "Online Store"
      );
      onlineStorePublicationId = onlineStorePublication?.node?.id || null;
      if (!onlineStorePublicationId) {
        publishError = "Online Store publicationId not found.";
        console.error("[DEBUG] Online Store publicationId not found.");
      }
    } catch (err) {
      publishError = err.message;
      console.error("[DEBUG] Error fetching publications:", err);
    }
    // Step 3: Publish the subcategory if possible
    if (onlineStorePublicationId && newSubcat?.id) {
      try {
        const publishResp = await admin.graphql(
          `#graphql
          mutation publishCollection($id: ID!, $publicationId: ID!) {
            publishablePublish(id: $id, input: [{ publicationId: $publicationId }]) {
              publishable {
                publishedOnPublication(publicationId: $publicationId)
              }
              userErrors { field message }
            }
          }`,
          {
            variables: {
              id: newSubcat.id,
              publicationId: onlineStorePublicationId
            }
          }
        );
        const publishJson = await publishResp.json();
        publicationResult = publishJson.data.publishablePublish;
        if (publishJson.data.publishablePublish.userErrors?.length > 0) {
          publishError = publishJson.data.publishablePublish.userErrors.map(e => e.message).join(", ");
          console.error("[DEBUG] Publish userErrors:", publishJson.data.publishablePublish.userErrors);
        } else {
          console.log(`[DEBUG] Subcategory published to Online Store. publicationId: ${onlineStorePublicationId}`);
        }
      } catch (err) {
        publishError = err.message;
        console.error("[DEBUG] Error publishing subcategory:", err);
      }
    }
    // Get parent's subcat metafield
    const metafieldsResp = await admin.graphql(
      `#graphql
      query getParentMetafields($id: ID!) {
        collection(id: $id) {
          metafields(first: 10, namespace: "custom") {
            edges { node { id key value type namespace references(first: 50) { edges { node { ... on Collection { id } } } } } }
          }
        }
      }`,
      { variables: { id: parentId } }
    );
    const metafieldsJson = await metafieldsResp.json();
    const subcatMetafield = metafieldsJson.data.collection.metafields.edges.find(
      edge => edge.node.key === "subcat"
    );
    let subcatIds = [];
    if (subcatMetafield && subcatMetafield.node.references) {
      subcatIds = subcatMetafield.node.references.edges.map(e => e.node.id);
    }
    subcatIds.push(newSubcat.id);
    // Set or update metafield
    const metafieldInput = {
      ownerId: parentId,
      namespace: "custom",
      key: "subcat",
      type: "list.collection_reference",
      value: JSON.stringify(subcatIds)
    };
    await admin.graphql(
      `#graphql
      mutation setSubcatMetafield($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id key value }
          userErrors { field message }
        }
      }`,
      { variables: { metafields: [metafieldInput] } }
    );
    // Step 4: Return result with debug info
    if (publishError) {
      return json({
        success: true,
        message: "Subcategory created, but publication to Online Store failed: " + publishError,
        publicationId: onlineStorePublicationId,
        debug: publicationResult
      });
    }
    return json({
      success: true,
      message: "Subcategory created and published to Online Store.",
      publicationId: onlineStorePublicationId,
      debug: publicationResult
    });
  }

  return json({ success: false });
};

export default function Index() {
  const { collections, error } = useLoaderData();
  const actionData = useActionData();
  const navigate = useNavigate();
  const location = useLocation();
  const submit = useSubmit();
  const navigation = useNavigation();
  
  const [openAccordions, setOpenAccordions] = useState({});
  const [isCreateCollectionOpen, setIsCreateCollectionOpen] = useState(false);
  const [isCreateSubcatOpen, setIsCreateSubcatOpen] = useState(false);
  const [newCollectionTitle, setNewCollectionTitle] = useState("");
  const [newCollectionDescription, setNewCollectionDescription] = useState("");
  const [newCollectionImage, setNewCollectionImage] = useState("");
  const [subcatTitle, setSubcatTitle] = useState("");
  const [subcatDescription, setSubcatDescription] = useState("");
  const [subcatImage, setSubcatImage] = useState("");
  const [subcatParent, setSubcatParent] = useState("");
  const [banner, setBanner] = useState(null);
  const [isCollectionImageProcessing, setIsCollectionImageProcessing] = useState(false);
  const [isSubcatImageProcessing, setIsSubcatImageProcessing] = useState(false);
  const [newCollectionType, setNewCollectionType] = useState("");
  const [newCollectionRules, setNewCollectionRules] = useState([{ column: "TITLE", relation: "EQUALS", condition: "", value: "" }]);
  const [newCollectionGlobalCondition, setNewCollectionGlobalCondition] = useState("AND");
  const [subcatType, setSubcatType] = useState("");
  const [subcatRules, setSubcatRules] = useState([{ column: "TITLE", relation: "EQUALS", condition: "", value: "" }]);
  const [subcatGlobalCondition, setSubcatGlobalCondition] = useState("AND");
  
  // When returning from an edit page, open the accordion of the collection that was edited.
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const fromCollectionId = searchParams.get('fromCollectionId');
    if (fromCollectionId) {
      setOpenAccordions(prev => ({ ...prev, [fromCollectionId]: true }));
      // Clean up URL
      const newUrl = location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
  }, [location.search]);
  
  // Toggle accordion open/close
  const toggleAccordion = useCallback((id) => {
    setOpenAccordions(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);
  
  const handleEdit = useCallback((collectionId, parentId = null) => {
    console.log(collectionId, parentId);
    const editId = collectionId.replace('gid://shopify/Collection/', '');
    let returnTo = `/app`;
    if (parentId) {
      returnTo = `/app?fromCollectionId=${parentId}`;
    }
    navigate(`/app/collections/edit/${editId}?parentId=${parentId || ''}&returnTo=${encodeURIComponent(returnTo)}`);
  }, [navigate]);
  
  const handleAddSubcategory = (parentId) => {
    setSubcatParent(parentId);
    setIsCreateSubcatOpen(true);
  };
  
  const handleAddNewRule = () => {
    setNewCollectionRules([...newCollectionRules, { column: "TITLE", relation: "EQUALS", condition: "", value: "" }]);
  };

  const handleRemoveNewRule = (index) => {
    const newRules = newCollectionRules.filter((_, i) => i !== index);
    setNewCollectionRules(newRules);
  };

  const handleUpdateNewRule = (index, field, value) => {
    const newRules = [...newCollectionRules];
    newRules[index][field] = value;
    setNewCollectionRules(newRules);
  };
  
  const handleCreateCollection = () => {
    if (!newCollectionType) {
      setBanner(<Banner status="critical" title="Please select a collection type." onDismiss={() => setBanner(null)} />);
      return;
    }
    if (newCollectionType === "smart") {
      const validRules = newCollectionRules.filter(r => r.column && r.relation && (r.value || r.condition));
      if (!validRules.length) {
        setBanner(<Banner status="critical" title="You must add at least one complete rule for a Smart Collection." onDismiss={() => setBanner(null)} />);
        return;
      }
    }
    const formData = new FormData();
    formData.append("action", "create_collection");
    formData.append("title", newCollectionTitle);
    formData.append("description", newCollectionDescription);
    formData.append("imageUrl", newCollectionImage);
    formData.append("collectionType", newCollectionType === "smart" ? "SMART" : "CUSTOM");
    if (newCollectionType === "smart") {
      const validRules = newCollectionRules.filter(r => r.column && r.relation && (r.value || r.condition));
      const apiRules = validRules.map(({ column, relation, value, condition }) => ({
        column,
        relation,
        condition: value !== undefined ? value : condition
      }));
      const ruleSet = {
        rules: apiRules,
        appliedDisjunctively: newCollectionGlobalCondition === 'OR'
      };
      formData.append("ruleSet", JSON.stringify(ruleSet));
    }
    submit(formData, { method: "post" });
    setIsCreateCollectionOpen(false);
    setNewCollectionTitle("");
    setNewCollectionDescription("");
    setNewCollectionImage("");
    setNewCollectionType("");
    setNewCollectionRules([{ column: "TITLE", relation: "EQUALS", condition: "", value: "" }]);
    setNewCollectionGlobalCondition("AND");
  };

  const handleAddSubcatRule = () => {
    setSubcatRules([...subcatRules, { column: "TITLE", relation: "EQUALS", condition: "", value: "" }]);
  };

  const handleRemoveSubcatRule = (index) => {
    setSubcatRules(subcatRules.filter((_, i) => i !== index));
  };

  const handleUpdateSubcatRule = (index, field, value) => {
    const newRules = [...subcatRules];
    newRules[index][field] = value;
    setSubcatRules(newRules);
  };

  const handleCreateSubcategory = () => {
    if (!subcatTitle || !subcatType) {
      setBanner(<Banner status="critical" title="Please fill in all required fields for subcategory." onDismiss={() => setBanner(null)} />);
      return;
    }
    if (subcatType === "smart") {
      const validRules = subcatRules.filter(r => r.column && r.relation && (r.value || r.condition));
      if (!validRules.length) {
        setBanner(<Banner status="critical" title="You must add at least one complete rule for a Smart Subcategory." onDismiss={() => setBanner(null)} />);
        return;
      }
    }
    const formData = new FormData();
    formData.append("action", "create_subcategory");
    formData.append("title", subcatTitle);
    formData.append("description", subcatDescription);
    formData.append("imageUrl", subcatImage);
    formData.append("parentId", subcatParent);
    formData.append("subcatType", subcatType === "smart" ? "SMART" : "CUSTOM");
    if (subcatType === "smart") {
      const validRules = subcatRules.filter(r => r.column && r.relation && (r.value || r.condition));
      const apiRules = validRules.map(({ column, relation, value, condition }) => ({
        column,
        relation,
        condition: value !== undefined ? value : condition
      }));
      const ruleSet = {
        rules: apiRules,
        appliedDisjunctively: subcatGlobalCondition === 'OR'
      };
      formData.append("ruleSet", JSON.stringify(ruleSet));
    }
    submit(formData, { method: "post" });
    setIsCreateSubcatOpen(false);
    setSubcatTitle("");
    setSubcatDescription("");
    setSubcatImage("");
    setSubcatParent("");
    setSubcatType("");
    setSubcatRules([{ column: "TITLE", relation: "EQUALS", condition: "", value: "" }]);
    setSubcatGlobalCondition("AND");
  };
  
  useEffect(() => {
    if (actionData) {
      if(actionData.success) {
        setBanner(<Banner status="success" title={actionData.message} onDismiss={() => setBanner(null)} />);
      } else if(actionData.errors) {
        setBanner(<Banner status="critical" title="There was an error" onDismiss={() => setBanner(null)}>
          <List type="bullet">
            {actionData.errors.map((err, idx) => <List.Item key={idx}>{err.message}</List.Item>)}
          </List>
        </Banner>);
      }
    }
  }, [actionData]);
  
  if (error) {
    return (
      <Page title="Collections">
        <EmptyState
          heading="Error loading collections"
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
        >
          <p>{error}</p>
        </EmptyState>
      </Page>
    );
  }
  
  const isLoading = navigation.state === "loading" || navigation.state === "submitting";

  const renderSubcategories = (parentCollection) => {
    const { subcategories, id: parentId } = parentCollection;
    
    if (!subcategories || subcategories.length === 0) {
      return (
        <Box paddingBlockStart="200" paddingBlockEnd="200" paddingInlineStart="500" paddingInlineEnd="500">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="span" variant="bodyMd" tone="subdued">No subcategories yet.</Text>
            <Button
              icon={PlusIcon}
              onClick={() => handleAddSubcategory(parentId)}
              size="slim"
            >
              Add Subcategory
            </Button>
          </InlineStack>
        </Box>
      );
    }
    
    return (
      <ResourceList
        resourceName={{ singular: 'subcategory', plural: 'subcategories' }}
        items={subcategories}
        renderItem={(item) => {
          const { id, title, image, productsCount } = item;
          const media = (
            <Thumbnail
              source={image?.url || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-collection-1.png"}
              alt={title}
              size="small"
            />
          );

          return (
            
            <ResourceItem
              id={id}
              media={media}
              accessibilityLabel={`View details for ${title}`}
              onClick={() => handleEdit(id, parentId)}
            >
              <InlineStack align="space-between" blockAlign="center" wrap={false}>
                <Text variant="bodyMd" fontWeight="bold" as="h3">{title}</Text>
                <Badge tone="info">{productsCount.count} products</Badge>
              </InlineStack>
            </ResourceItem>
          );
        }}
      />
    );
  };
  
  const emptyStateMarkup = (
    <EmptyState
      heading="Create collections to group your products"
      action={{
        content: "Create Collection",
        onAction: () => setIsCreateCollectionOpen(true),
      }}
      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
    >
      <p>Group products into categories and subcategories to make them easier for customers to find.</p>
    </EmptyState>
  );

  return (
    <Page
      title="Collections Manager"
      primaryAction={{
        content: "Create Collection",
        onAction: () => setIsCreateCollectionOpen(true),
        disabled: isLoading,
      }}
      secondaryActions={[
        {
          content: "Create Subcategory",
          onAction: () => setIsCreateSubcatOpen(true),
          disabled: isLoading,
        }
      ]}
    >
      {banner && (
        <div style={{ marginBottom: 16 }}>
          {banner}
        </div>
      )}
      <Modal
        open={isCreateCollectionOpen}
        onClose={() => setIsCreateCollectionOpen(false)}
        title="Create New Collection"
        primaryAction={{
          content: "Create",
          onAction: handleCreateCollection,
          loading: isLoading,
          disabled: isCollectionImageProcessing || !newCollectionTitle || !newCollectionType || (newCollectionType === "smart" && newCollectionRules.filter(r => r.column && r.relation && (r.value || r.condition)).length === 0)
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setIsCreateCollectionOpen(false) }]}
      >
        <Modal.Section>
          <Form onSubmit={handleCreateCollection}>
            <FormLayout>
              <TextField
                label="Title"
                value={newCollectionTitle}
                onChange={setNewCollectionTitle}
                autoComplete="off"
                requiredIndicator
              />
              <TextField
                label="Description"
                value={newCollectionDescription}
                onChange={setNewCollectionDescription}
                autoComplete="off"
                multiline={4}
              />
              <CollectionImageUpload
                onImageUpload={setNewCollectionImage}
                initialImageUrl={newCollectionImage}
                onProcessingChange={setIsCollectionImageProcessing}
              />
              <BlockStack gap="200">
                <Text variant="headingSm">Collection Type <span style={{ color: 'red' }}>*</span></Text>
                <Text variant="bodySm" tone="subdued">Once created, collection type cannot be changed.</Text>
                <RadioButton
                  label="Manual (Custom) Collection"
                  checked={newCollectionType === "manual"}
                  id="manual"
                  name="collectionType"
                  onChange={() => setNewCollectionType("manual")}
                  disabled={false}
                />
                <RadioButton
                  label="Smart (Automated) Collection"
                  checked={newCollectionType === "smart"}
                  id="smart"
                  name="collectionType"
                  onChange={() => setNewCollectionType("smart")}
                  disabled={false}
                />
              </BlockStack>
              {newCollectionType === "smart" && (
                <BlockStack gap="400">
                  <Text variant="headingMd">Smart Collection Rules</Text>
                  <Text variant="bodySm" tone="subdued">Products that match these rules will be automatically added to this collection.</Text>
                  <FormLayout>
                    <FormLayout.Group>
                      <RadioButton
                        label="Products must match all conditions"
                        checked={newCollectionGlobalCondition === 'AND'}
                        id="all_conditions"
                        name="globalCondition"
                        onChange={() => setNewCollectionGlobalCondition('AND')}
                        disabled={false}
                      />
                      <RadioButton
                        label="Products can match any condition"
                        checked={newCollectionGlobalCondition === 'OR'}
                        id="any_condition"
                        name="globalCondition"
                        onChange={() => setNewCollectionGlobalCondition('OR')}
                        disabled={false}
                      />
                    </FormLayout.Group>
                    {newCollectionRules.map((rule, index) => (
                      <FormLayout.Group key={index} condensed>
                        <Card>
                          <BlockStack gap="200">
                            <InlineStack align="space-between">
                              <Text variant="headingSm" as="h3">Rule {index + 1}</Text>
                              <Button
                                icon={PlusIcon}
                                onClick={handleAddNewRule}
                                accessibilityLabel="Add rule"
                                disabled={false}
                              >
                                Add Rule
                              </Button>
                              {newCollectionRules.length > 1 && (
                                <Button
                                  icon={MinusIcon}
                                  onClick={() => handleRemoveNewRule(index)}
                                  accessibilityLabel="Remove rule"
                                  disabled={false}
                                />
                              )}
                            </InlineStack>
                            <FormLayout>
                              <FormLayout.Group>
                                <Select
                                  label="Column"
                                  options={[
                                    { label: "Title", value: "TITLE" },
                                    { label: "Type", value: "TYPE" },
                                    { label: "Vendor", value: "VENDOR" },
                                    { label: "Price", value: "PRICE" },
                                    { label: "Tag", value: "TAG" },
                                    { label: "Category", value: "CATEGORY" },
                                    { label: "Inventory Stock", value: "INVENTORY_STOCK" },
                                    { label: "Weight", value: "WEIGHT" },
                                    { label: "Variants", value: "VARIANT" },
                                    { label: "Metafield", value: "METAFIELD" }
                                  ]}
                                  value={rule.column}
                                  onChange={(value) => handleUpdateNewRule(index, "column", value)}
                                  disabled={false}
                                />
                                <Select
                                  label="Relation"
                                  options={[
                                    { label: "Equals", value: "EQUALS" },
                                    { label: "Not equals", value: "NOT_EQUALS" },
                                    { label: "Greater than", value: "GREATER_THAN" },
                                    { label: "Less than", value: "LESS_THAN" },
                                    { label: "Starts with", value: "STARTS_WITH" },
                                    { label: "Ends with", value: "ENDS_WITH" },
                                    { label: "Contains", value: "CONTAINS" },
                                    { label: "Not contains", value: "NOT_CONTAINS" }
                                  ]}
                                  value={rule.relation}
                                  onChange={(value) => handleUpdateNewRule(index, "relation", value)}
                                  disabled={false}
                                />
                                <TextField
                                  label="Value"
                                  value={rule.value || ""}
                                  onChange={(value) => handleUpdateNewRule(index, "value", value)}
                                  autoComplete="off"
                                  disabled={false}
                                />
                              </FormLayout.Group>
                            </FormLayout>
                          </BlockStack>
                        </Card>
                      </FormLayout.Group>
                    ))}
                  </FormLayout>
                </BlockStack>
              )}
            </FormLayout>
          </Form>
        </Modal.Section>
      </Modal>

      <Modal
        open={isCreateSubcatOpen}
        onClose={() => setIsCreateSubcatOpen(false)}
        title="Create Subcategory"
        primaryAction={{
          content: "Create",
          onAction: handleCreateSubcategory,
          loading: isLoading,
          disabled: isSubcatImageProcessing || !subcatTitle || !subcatType || (subcatType === "smart" && subcatRules.filter(r => r.column && r.relation && (r.value || r.condition)).length === 0)
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setIsCreateSubcatOpen(false) }]}
      >
        <Modal.Section>
          <Form onSubmit={handleCreateSubcategory}>
            <FormLayout>
              <Select
                label="Parent Collection"
                options={collections.map(c => ({ label: c.title, value: c.id }))}
                value={subcatParent}
                onChange={setSubcatParent}
                placeholder="Select parent collection"
                requiredIndicator
              />
              <TextField
                label="Title"
                value={subcatTitle}
                onChange={setSubcatTitle}
                autoComplete="off"
                requiredIndicator
              />
              <BlockStack gap="200">
                <Text variant="headingSm">Collection Type <span style={{ color: 'red' }}>*</span></Text>
                <RadioButton
                  label="Manual (Custom) Collection"
                  checked={subcatType === "manual"}
                  id="subcat-manual"
                  name="subcatType"
                  onChange={() => setSubcatType("manual")}
                  disabled={false}
                />
                <RadioButton
                  label="Smart (Automated) Collection"
                  checked={subcatType === "smart"}
                  id="subcat-smart"
                  name="subcatType"
                  onChange={() => setSubcatType("smart")}
                  disabled={false}
                />
              </BlockStack>
              {subcatType === "smart" && (
                <BlockStack gap="400">
                  <Text variant="headingMd">Smart Collection Rules</Text>
                  <Text variant="bodySm" tone="subdued">Products that match these rules will be automatically added to this subcategory.</Text>
                  <FormLayout>
                    <FormLayout.Group>
                      <RadioButton
                        label="Products must match all conditions"
                        checked={subcatGlobalCondition === 'AND'}
                        id="subcat_all_conditions"
                        name="subcatGlobalCondition"
                        onChange={() => setSubcatGlobalCondition('AND')}
                        disabled={false}
                      />
                      <RadioButton
                        label="Products can match any condition"
                        checked={subcatGlobalCondition === 'OR'}
                        id="subcat_any_condition"
                        name="subcatGlobalCondition"
                        onChange={() => setSubcatGlobalCondition('OR')}
                        disabled={false}
                      />
                    </FormLayout.Group>
                    {subcatRules.map((rule, index) => (
                      <FormLayout.Group key={index} condensed>
                        <Card>
                          <BlockStack gap="200">
                            <InlineStack align="space-between">
                              <Text variant="headingSm" as="h3">Rule {index + 1}</Text>
                              <Button
                                icon={PlusIcon}
                                onClick={handleAddSubcatRule}
                                accessibilityLabel="Add rule"
                                disabled={false}
                              >
                                Add Rule
                              </Button>
                              {subcatRules.length > 1 && (
                                <Button
                                  icon={MinusIcon}
                                  onClick={() => handleRemoveSubcatRule(index)}
                                  accessibilityLabel="Remove rule"
                                  disabled={false}
                                />
                              )}
                            </InlineStack>
                            <FormLayout>
                              <FormLayout.Group>
                                <Select
                                  label="Column"
                                  options={[
                                    { label: "Title", value: "TITLE" },
                                    { label: "Type", value: "TYPE" },
                                    { label: "Vendor", value: "VENDOR" },
                                    { label: "Price", value: "PRICE" },
                                    { label: "Tag", value: "TAG" },
                                    { label: "Category", value: "CATEGORY" },
                                    { label: "Inventory Stock", value: "INVENTORY_STOCK" },
                                    { label: "Weight", value: "WEIGHT" },
                                    { label: "Variants", value: "VARIANT" },
                                    { label: "Metafield", value: "METAFIELD" }
                                  ]}
                                  value={rule.column}
                                  onChange={(value) => handleUpdateSubcatRule(index, "column", value)}
                                  disabled={false}
                                />
                                <Select
                                  label="Relation"
                                  options={[
                                    { label: "Equals", value: "EQUALS" },
                                    { label: "Not equals", value: "NOT_EQUALS" },
                                    { label: "Greater than", value: "GREATER_THAN" },
                                    { label: "Less than", value: "LESS_THAN" },
                                    { label: "Starts with", value: "STARTS_WITH" },
                                    { label: "Ends with", value: "ENDS_WITH" },
                                    { label: "Contains", value: "CONTAINS" },
                                    { label: "Not contains", value: "NOT_CONTAINS" }
                                  ]}
                                  value={rule.relation}
                                  onChange={(value) => handleUpdateSubcatRule(index, "relation", value)}
                                  disabled={false}
                                />
                                <TextField
                                  label="Value"
                                  value={rule.value || ""}
                                  onChange={(value) => handleUpdateSubcatRule(index, "value", value)}
                                  autoComplete="off"
                                  disabled={false}
                                />
                              </FormLayout.Group>
                            </FormLayout>
                          </BlockStack>
                        </Card>
                      </FormLayout.Group>
                    ))}
                  </FormLayout>
                </BlockStack>
              )}
              <CollectionImageUpload
                onImageUpload={setSubcatImage}
                initialImageUrl={subcatImage}
                onProcessingChange={setIsSubcatImageProcessing}
              />
            </FormLayout>
          </Form>
        </Modal.Section>
      </Modal>

      <Layout>
        <Layout.Section>
          {isLoading && !collections.length ? (
            <div style={{ textAlign: 'center', padding: '20px' }}>
              <Spinner accessibilityLabel="Loading collections" size="large" />
            </div>
          ) : (
            <BlockStack gap="500">
              {collections.length === 0 ? (
                emptyStateMarkup
              ) : (
                collections.map((collection) => (
                  <Card key={collection.id}>
                    <Box padding="400">
                      <InlineStack align="space-between" blockAlign="center" wrap={false}>
                        <InlineStack gap="400" blockAlign="center">
                          <Thumbnail
                            source={collection.image?.url || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-collection-1.png"}
                            alt={collection.title}
                          />
                          <BlockStack gap="100">
                            <Text variant="headingMd" as="h2">{collection.title}</Text>
                            <Text variant="bodyMd" tone="subdued">
                              {collection.productsCount.count} products
                            </Text>
                          </BlockStack>
                        </InlineStack>
                        <InlineStack gap="200" align="end">
                           <Button
                            onClick={() => handleAddSubcategory(collection.id)}
                            icon={PlusIcon}
                          >
                            Add Subcategory
                          </Button>
                          <Button 
                            icon={EditIcon} 
                            onClick={() => handleEdit(collection.id)}
                            variant="tertiary"
                          >
                            Edit
                          </Button>
                        </InlineStack>
                      </InlineStack>
                    </Box>

                    <Divider />
                    
                    <Box
                      as="div"
                      style={{
                        cursor: 'pointer',
                        padding: 'var(--p-space-300) var(--p-space-400)',
                      }}
                      onClick={() => toggleAccordion(collection.id)}
                    >
                      <InlineStack align="space-between" blockAlign="center">
                        <Text variant="bodyMd" fontWeight="bold">
                          {collection.subcategoriesCount} Subcategories
                        </Text>
                        <Button
                          plain
                          icon={openAccordions[collection.id] ? ChevronUpIcon : ChevronDownIcon}
                          accessibilityLabel={openAccordions[collection.id] ? "Collapse" : "Expand"}
                        />
                      </InlineStack>
                    </Box>

                    <Collapsible
                      open={openAccordions[collection.id]}
                      id={`collapsible-${collection.id}`}
                      transition={{ duration: '300ms', timingFunction: 'ease-in-out' }}
                    >
                      {renderSubcategories(collection)}
                    </Collapsible>
                  </Card>
                ))
              )}
            </BlockStack>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
