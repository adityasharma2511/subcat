import { useState, useCallback, useEffect } from "react";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useLocation, useSubmit, useActionData, useNavigation } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { ChevronDownIcon, ChevronUpIcon, EditIcon, PlusIcon } from "@shopify/polaris-icons";
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
    const collectionInput = {
      title,
      descriptionHtml: description
    };
    if (imageUrl && imageUrl.trim() !== "") {
      collectionInput.image = { src: imageUrl };
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
    if (!title || !parentId) {
      return json({ success: false, message: "Subcategory title and parent are required" });
    }
    // Create the subcategory collection
    const collectionInput = { title, descriptionHtml: description };
    if (imageUrl && imageUrl.trim() !== "") {
      collectionInput.image = { src: imageUrl };
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
    return json({ success: true, message: "Subcategory created and added to parent collection." });
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
  
  const handleCreateCollection = () => {
    const formData = new FormData();
    formData.append("action", "create_collection");
    formData.append("title", newCollectionTitle);
    formData.append("description", newCollectionDescription);
    formData.append("imageUrl", newCollectionImage);
    submit(formData, { method: "post" });
    setIsCreateCollectionOpen(false);
    setNewCollectionTitle("");
    setNewCollectionDescription("");
    setNewCollectionImage("");
  };

  const handleCreateSubcategory = () => {
    const formData = new FormData();
    formData.append("action", "create_subcategory");
    formData.append("title", subcatTitle);
    formData.append("description", subcatDescription);
    formData.append("imageUrl", subcatImage);
    formData.append("parentId", subcatParent);
    submit(formData, { method: "post" });
    setIsCreateSubcatOpen(false);
    setSubcatTitle("");
    setSubcatDescription("");
    setSubcatImage("");
    setSubcatParent("");
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
      {banner}
      <Modal
        open={isCreateCollectionOpen}
        onClose={() => setIsCreateCollectionOpen(false)}
        title="Create New Collection"
        primaryAction={{
          content: "Create",
          onAction: handleCreateCollection,
          loading: isLoading,
          disabled: isCollectionImageProcessing || !newCollectionTitle
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
          disabled: isSubcatImageProcessing || !subcatTitle || !subcatParent
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
              <TextField
                label="Description"
                value={subcatDescription}
                onChange={setSubcatDescription}
                autoComplete="off"
                multiline={4}
              />
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
