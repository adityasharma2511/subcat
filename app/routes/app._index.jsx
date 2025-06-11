import * as Polaris from '@shopify/polaris';
import { useState, useCallback, useEffect } from "react";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useLocation, useSubmit, useActionData, useNavigation } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { ChevronDownIcon, ChevronUpIcon, EditIcon, PlusIcon } from "@shopify/polaris-icons";

const {
  Page,
  Layout,
  Card,
  Text,
  ResourceList,
  ResourceItem,
  Icon,
  Button,
  InlineStack,
  BlockStack,
  Box,
  Divider,
  Thumbnail,
  Badge,
  EmptyState,
  Spinner,
  Banner,
  Modal,
  LegacyStack,
  TextField,
  Select,
} = Polaris;

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  
  try {
    // Fetch all collections with their subcategory metafields
    const collectionsResponse = await admin.graphql(
      `#graphql
      query GetCollectionsWithSubcategories {
        collections(first: 100) {
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
                          }
                        }
                      }
                    }
                  }
                }
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
        hasSubcategories: subcategories.length > 0
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
        message: "Failed to create collection: " + responseJson.data.collectionCreate.userErrors.map(e => e.message).join(", ")
      });
    }
    return json({ success: true, message: "Collection created successfully" });
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
        message: "Failed to create subcategory: " + responseJson.data.collectionCreate.userErrors.map(e => e.message).join(", ")
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
  
  // State to track which accordions are open
  const [openAccordions, setOpenAccordions] = useState({});
  const [lastVisited, setLastVisited] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [loadingSubcat, setLoadingSubcat] = useState(null);
  
  // Add state for modals and form fields
  const [isCreateCollectionOpen, setIsCreateCollectionOpen] = useState(false);
  const [isCreateSubcatOpen, setIsCreateSubcatOpen] = useState(false);
  const [newCollectionTitle, setNewCollectionTitle] = useState("");
  const [newCollectionDescription, setNewCollectionDescription] = useState("");
  const [newCollectionImage, setNewCollectionImage] = useState("");
  const [subcatTitle, setSubcatTitle] = useState("");
  const [subcatDescription, setSubcatDescription] = useState("");
  const [subcatImage, setSubcatImage] = useState("");
  const [subcatParent, setSubcatParent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [banner, setBanner] = useState(null);
  
  // Check for any collection ID in the URL search params (used for returning to this page)
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const fromCollectionId = searchParams.get('fromCollectionId');
    const needsRefresh = searchParams.get('refresh') === 'true';
    
    if (fromCollectionId) {
      // Open the accordion for this collection ID
      setOpenAccordions(prev => ({
        ...prev,
        [`gid://shopify/Collection/${fromCollectionId}`]: true
      }));
      
      // If refresh flag is present, force a data reload
      if (needsRefresh) {
        const formData = new FormData();
        formData.append("action", "refresh_data");
        submit(formData, { method: "post" });
      }
      
      // Clean up URL without reloading the page
      const newUrl = location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
    
    if (navigation.state === 'idle') {
      setLoadingSubcat(null);
      setEditingItem(null);
    }
  }, [location, submit, navigation.state]);
  
  // Toggle accordion open/close
  const toggleAccordion = useCallback((id) => {
    setOpenAccordions(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  }, []);
  
  // Handle edit button click with return URL
  const handleEdit = useCallback((id) => {
    // Set the editing state immediately for visual feedback
    setEditingItem(id);
    
    // Extract collection ID from the Shopify ID format
    const collectionId = id.replace('gid://shopify/Collection/', '');
    
    // Save the ID before navigation for reference when returning
    setLastVisited(collectionId);
    
    // Navigate with return route
    navigate(`/app/collections/edit/${collectionId}?returnTo=/app`);
  }, [navigate]);
  
  // Handle adding subcategories
  const handleAddSubcategories = useCallback((parentId) => {
    setLoadingSubcat(parentId);
    const collectionId = parentId.replace('gid://shopify/Collection/', '');
    navigate(`/app/collections/edit/${collectionId}?returnTo=/app&focusSubcategories=true`);
  }, [navigate]);
  
  // Render subcategories list
  const renderSubcategories = (parentCollection) => {
    const { subcategories, id: parentId } = parentCollection;
    
    if (!subcategories || subcategories.length === 0) {
      return (
        <Box padding="300">
          <InlineStack align="space-between">
            <Text tone="subdued">No subcategories</Text>
            <Button 
              icon={PlusIcon} 
              onClick={() => handleAddSubcategories(parentId)}
              variant="primary"
              loading={loadingSubcat === parentId}
            >
              Create Subcategory
            </Button>
          </InlineStack>
        </Box>
      );
    }
    
    return (
      <Box padding="300">
        <BlockStack gap="300">
          {subcategories.map(subcategory => (
            <Box
              key={subcategory.id}
              background="bg-surface-secondary"
              borderRadius="100" 
              padding="300"
            >
              <InlineStack gap="400" align="space-between">
                <InlineStack gap="300">
                  <Thumbnail
                    source={subcategory.image?.url || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-collection-1.png"}
                    alt={subcategory.title}
                    size="small"
                  />
                  <Text variant="bodyMd" fontWeight="medium">{subcategory.title}</Text>
                </InlineStack>
                <Button 
                  icon={EditIcon} 
                  onClick={() => handleEdit(subcategory.id)}
                  variant="tertiary"
                  loading={editingItem === subcategory.id}
                  disabled={editingItem === subcategory.id}
                >
                  Edit
                </Button>
              </InlineStack>
            </Box>
          ))}
          
          <Box padding="300">
            <Button 
              icon={PlusIcon} 
              onClick={() => handleAddSubcategories(parentId)}
              variant="primary"
              loading={loadingSubcat === parentId}
            >
              Add More Subcategories
            </Button>
          </Box>
        </BlockStack>
      </Box>
    );
  };
  
  // Show banner if actionData has a message
  useEffect(() => {
    if (actionData?.message) {
      setBanner(
        <Banner
          status={actionData.success ? "success" : "critical"}
          title={actionData.message}
          onDismiss={() => setBanner(null)}
        />
      );
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
  
  return (
    <Page
      title="Collections Manager"
      primaryAction={{
        content: "Create Collection",
        onAction: () => setIsCreateCollectionOpen(true)
      }}
      secondaryActions={[
        {
          content: "Create Subcategory",
          onAction: () => setIsCreateSubcatOpen(true)
        }
      ]}
    >
      {banner}
      {/* Create Collection Modal */}
      <Modal
        open={isCreateCollectionOpen}
        onClose={() => setIsCreateCollectionOpen(false)}
        title="Create New Collection"
        primaryAction={{
          content: "Create",
          onAction: async () => {
            setIsSubmitting(true);
            const formData = new FormData();
            formData.append("action", "create_collection");
            formData.append("title", newCollectionTitle);
            formData.append("description", newCollectionDescription);
            formData.append("imageUrl", newCollectionImage);
            await submit(formData, { method: "post" });
            setIsSubmitting(false);
            setIsCreateCollectionOpen(false);
            setNewCollectionTitle("");
            setNewCollectionDescription("");
            setNewCollectionImage("");
          },
          loading: isSubmitting
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setIsCreateCollectionOpen(false)
          }
        ]}
      >
        <Modal.Section>
          <LegacyStack vertical>
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
            <TextField
              label="Image URL"
              value={newCollectionImage}
              onChange={setNewCollectionImage}
              autoComplete="off"
              placeholder="https://example.com/your-image.jpg"
              helpText="Enter a valid image URL (JPG, PNG, GIF)"
            />
          </LegacyStack>
        </Modal.Section>
      </Modal>
      {/* Create Subcategory Modal */}
      <Modal
        open={isCreateSubcatOpen}
        onClose={() => setIsCreateSubcatOpen(false)}
        title="Create Subcategory"
        primaryAction={{
          content: "Create",
          onAction: async () => {
            setIsSubmitting(true);
            const formData = new FormData();
            formData.append("action", "create_subcategory");
            formData.append("title", subcatTitle);
            formData.append("description", subcatDescription);
            formData.append("imageUrl", subcatImage);
            formData.append("parentId", subcatParent);
            await submit(formData, { method: "post" });
            setIsSubmitting(false);
            setIsCreateSubcatOpen(false);
            setSubcatTitle("");
            setSubcatDescription("");
            setSubcatImage("");
            setSubcatParent("");
          },
          loading: isSubmitting
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setIsCreateSubcatOpen(false)
          }
        ]}
      >
        <Modal.Section>
          <LegacyStack vertical>
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
            <TextField
              label="Image URL"
              value={subcatImage}
              onChange={setSubcatImage}
              autoComplete="off"
              placeholder="https://example.com/your-image.jpg"
              helpText="Enter a valid image URL (JPG, PNG, GIF)"
            />
            <Select
              label="Parent Collection"
              options={collections.map(c => ({ label: c.title, value: c.id }))}
              value={subcatParent}
              onChange={setSubcatParent}
              placeholder="Select parent collection"
              requiredIndicator
            />
          </LegacyStack>
        </Modal.Section>
      </Modal>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="500">
              {collections.length === 0 ? (
                <EmptyState
                  heading="No collections found"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>Create your first collection to get started.</p>
                </EmptyState>
              ) : (
                collections.map((collection, index) => (
                  <div key={collection.id}>
                    {index > 0 && <Divider />}
                    <Box padding="300">
                      <BlockStack gap="300">
                        <InlineStack gap="400" align="space-between">
                          <InlineStack gap="300" blockAlign="center">
                            <Button
                              icon={openAccordions[collection.id] ? ChevronUpIcon : ChevronDownIcon}
                              onClick={() => toggleAccordion(collection.id)}
                              variant="plain"
                              accessibilityLabel={openAccordions[collection.id] ? "Collapse" : "Expand"}
                            />
                            <Thumbnail
                              source={collection.image?.url || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-collection-1.png"}
                              alt={collection.title}
                              size="small"
                            />
                            <div>
                              <Text variant="headingMd" fontWeight="bold">{collection.title}</Text>
                              {collection.hasSubcategories && (
                                <Badge tone="info">Has Subcategories</Badge>
                              )}
                            </div>
                          </InlineStack>
                          <Button 
                            icon={EditIcon} 
                            onClick={() => handleEdit(collection.id)}
                            loading={editingItem === collection.id}
                            disabled={editingItem === collection.id}
                          >
                            Edit
                          </Button>
                        </InlineStack>
                        
                        {openAccordions[collection.id] && (
                          <>
                            <Divider />
                            {renderSubcategories(collection)}
                          </>
                        )}
                      </BlockStack>
                    </Box>
                  </div>
                ))
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
