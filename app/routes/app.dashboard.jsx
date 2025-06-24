import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  TextField,
  Button,
  InlineStack,
  Form,
  ResourceList,
  Thumbnail,
  Badge,
  EmptyState,
  Spinner,
  Banner,
  Modal,
  LegacyStack,
  DropZone,
  Checkbox,
} from "@shopify/polaris";
import { useState } from "react";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useSubmit, useNavigation, useNavigate } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import CollectionImageUpload from '../components/CollectionImageUpload';

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  
  try {
    const response = await admin.graphql(
      `#graphql
      query GetCollections {
        collections(first: 50) {
          edges {
            node {
              id
              title
              handle
              descriptionHtml
              image {
                id
                url
                altText
              }
              updatedAt
              productsCount {
                count
              }
            }
          }
        }
      }`
    );

    const responseJson = await response.json();
    return json({
      collections: responseJson.data.collections.edges.map(edge => edge.node) || [],
      error: null,
      shop: session.shop
    });
  } catch (error) {
    console.error("Error fetching collections:", error);
    return json({
      collections: [],
      error: "Failed to load collections. Please try again.",
      shop: session.shop
    });
  }
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  
  try {
    const formData = await request.formData();
    const action = formData.get("action");

    if (action === "create_collection") {
      const title = formData.get("title");
      const description = formData.get("description");
      const imageUrl = formData.get("imageUrl");
      
      // Create collection input
      const collectionInput = {
        title,
        descriptionHtml: description
      };
      
      // If there's an image URL, add it to the collection input
      if (imageUrl && imageUrl.trim() !== "") {
        collectionInput.image = {
          src: imageUrl
        };
      }
      
      // Step 1: Create the collection
      const response = await admin.graphql(
        `#graphql
        mutation createCollection($input: CollectionInput!) {
          collectionCreate(input: $input) {
            collection {
              id
              title
              handle
              image {
                url
              }
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            input: collectionInput
          }
        }
      );
      
      const responseJson = await response.json();
      console.log("Collection create response:", JSON.stringify(responseJson, null, 2));
      
      if (responseJson.data?.collectionCreate?.userErrors?.length > 0) {
        return json({
          success: false,
          errors: responseJson.data.collectionCreate.userErrors,
          message: "Failed to create collection: " + 
            responseJson.data.collectionCreate.userErrors.map(e => e.message).join(", ")
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
        collection: newCollection,
        message: "Collection created and published to Online Store.",
        publicationId: onlineStorePublicationId,
        debug: publicationResult
      });
    }

    if (action === "delete_collection") {
      const collectionId = formData.get("collectionId");
      
      const response = await admin.graphql(
        `#graphql
        mutation deleteCollection($input: CollectionDeleteInput!) {
          collectionDelete(input: $input) {
            deletedCollectionId
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            input: {
              id: collectionId,
            },
          },
        }
      );

      const responseJson = await response.json();
      
      if (responseJson.data?.collectionDelete?.userErrors?.length > 0) {
        return json({
          success: false,
          message: "Failed to delete collection: " + 
            responseJson.data.collectionDelete.userErrors.map(e => e.message).join(", ")
        });
      }

      return json({
        success: true,
        message: "Collection deleted successfully"
      });
    }

    return json({
      success: false,
      message: "Invalid action specified"
    });
    
  } catch (error) {
    console.error("Error processing request:", error);
    return json({
      success: false,
      message: "An error occurred: " + error.message
    });
  }
};

export default function Dashboard() {
  const { collections, error, shop } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const isLoading = navigation.state === "submitting";

  const [isCreating, setIsCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [bannerVisible, setBannerVisible] = useState(true);

  const handleCreateCollection = () => {
    const formData = new FormData();
    formData.append("action", "create_collection");
    formData.append("title", title);
    formData.append("description", description);
    
    if (imageUrl) {
      formData.append("imageUrl", imageUrl);
    }

    submit(formData, { method: "post" });
    setIsCreating(false);
    setTitle("");
    setDescription("");
    setImageUrl("");
    console.log(formData);
  };

  const handleDeleteCollection = () => {
    if (!selectedCollection) return;
    
    const data = {
      action: "delete_collection",
      collectionId: selectedCollection.id
    };
    
    submit(data, { method: "post" });
    setShowDeleteModal(false);
    setSelectedCollection(null);
  };

  const handleImageUpload = (url) => {
    console.log("Image URL:", url);
    setImageUrl(url);
  };

  return (
    <Page title="Collections Management">
      <BlockStack gap="500">
        {actionData?.message && bannerVisible && (
          <Banner
            title={actionData.message}
            status={actionData.success ? "success" : "critical"}
            onDismiss={() => setBannerVisible(false)}
          />
        )}

        {error && bannerVisible && (
          <Banner
            title="Error"
            status="critical"
            onDismiss={() => setBannerVisible(false)}
          >
            <p>{error}</p>
          </Banner>
        )}

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text variant="headingMd" as="h2">
                    Your Collections
                  </Text>
                  <Button primary onClick={() => setIsCreating(true)}>
                    Create Collection
                  </Button>
                </InlineStack>

                {navigation.state === "loading" ? (
                  <div style={{ textAlign: "center", padding: "40px 0" }}>
                    <Spinner size="large" />
                  </div>
                ) : collections.length === 0 ? (
                  <EmptyState
                    heading="No collections found"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>Create your first collection to get started.</p>
                  </EmptyState>
                ) : (
                  <ResourceList
                    items={collections}
                    renderItem={(collection) => {
                      const { id, title, handle, image, updatedAt, productsCount } = collection;
                      const media = (
                        <Thumbnail
                          source={image?.url || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-collection-1.png"}
                          alt={image?.altText || title}
                        />
                      );

                      return (
                        <ResourceList.Item
                          id={id}
                          url={`https://${window.location.host}/admin/collections/${handle}`}
                          media={media}
                          accessibilityLabel={`View details for ${title}`}
                          shortcutActions={[
                            {
                              content: "Edit",
                              accessibilityLabel: `Edit ${title}`,
                              onClick: () => {
                                navigate(`/app/collections/edit/${id.split('/').pop()}`);
                              },
                            },
                            {
                              content: "Delete",
                              accessibilityLabel: `Delete ${title}`,
                              onClick: () => {
                                setSelectedCollection(collection);
                                setShowDeleteModal(true);
                              },
                            },
                          ]}
                        >
                          <Text variant="bodyMd" fontWeight="bold" as="h3">
                            {title}
                          </Text>
                          <div style={{ margin: "4px 0" }}>
                            <Badge>{`${productsCount.count} products`}</Badge>
                          </div>
                          <div style={{ fontSize: "12px", color: "#637381" }}>
                            Last updated: {new Date(updatedAt).toLocaleDateString()}
                          </div>
                        </ResourceList.Item>
                      );
                    }}
                  />
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Create Collection Modal */}
        <Modal
          open={isCreating}
          onClose={() => setIsCreating(false)}
          title="Create Collection"
          primaryAction={{
            content: "Create",
            onAction: handleCreateCollection,
            loading: isLoading,
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: () => setIsCreating(false),
            },
          ]}
        >
          <Modal.Section>
            <LegacyStack vertical>
              <TextField
                label="Title"
                value={title}
                onChange={setTitle}
                autoComplete="off"
                requiredIndicator
              />
              <TextField
                label="Description"
                value={description}
                onChange={setDescription}
                autoComplete="off"
                multiline={4}
              />
              <BlockStack gap="200">
                <Text variant="bodyMd" as="p">Collection Image</Text>
                <CollectionImageUpload 
                  onImageUpload={handleImageUpload}
                  initialImageUrl={imageUrl}
                  shop={shop}
                />
              </BlockStack>
            </LegacyStack>
          </Modal.Section>
        </Modal>

        {/* Delete Confirmation Modal */}
        <Modal
          open={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
          title="Delete Collection"
          primaryAction={{
            content: "Delete",
            onAction: handleDeleteCollection,
            destructive: true,
            loading: isLoading,
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: () => setShowDeleteModal(false),
            },
          ]}
        >
          <Modal.Section>
            <p>
              Are you sure you want to delete{" "}
              <strong>{selectedCollection?.title}</strong>? This action cannot be undone.
            </p>
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}
