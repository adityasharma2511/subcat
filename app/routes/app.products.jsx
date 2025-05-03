import {
  Page,
  Layout,
  Card,
  ResourceList,
  Thumbnail,
  Text,
  Button,
  Pagination,
  TextField,
  Modal,
  Form,
  FormLayout,
  Select,
  Banner,
  EmptyState,
  Spinner,
  BlockStack,
  InlineStack,
  Filters,
  ButtonGroup,
  Tag
} from '@shopify/polaris';
import { useState, useCallback, useEffect } from "react";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useSubmit, useNavigation } from "@remix-run/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  
  // Parse URL search params for pagination and filtering
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") || null;
  const direction = url.searchParams.get("direction") || "next";
  const searchQuery = url.searchParams.get("query") || "";
  const sortKey = url.searchParams.get("sortKey") || "TITLE";
  const reverse = url.searchParams.get("reverse") === "true";
  
  try {
    // Fetch products with pagination and sorting
    const response = await admin.graphql(
      `#graphql
      query GetProducts($first: Int, $last: Int, $after: String, $before: String, $query: String, $sortKey: ProductSortKeys, $reverse: Boolean) {
        products(first: $first, last: $last, after: $after, before: $before, query: $query, sortKey: $sortKey, reverse: $reverse) {
          edges {
            node {
              id
              title
              handle
              description
              vendor
              productType
              status
              createdAt
              featuredImage {
                id
                url
                altText
              }
              priceRangeV2 {
                minVariantPrice {
                  amount
                  currencyCode
                }
                maxVariantPrice {
                  amount
                  currencyCode
                }
              }
              tags
              totalInventory
              variants(first: 1) {
                edges {
                  node {
                    id
                    price
                    compareAtPrice
                    inventoryQuantity
                    sku
                  }
                }
              }
            }
            cursor
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
            startCursor
            endCursor
          }
        }
      }`,
      {
        variables: {
          first: direction === "next" ? 50 : null,
          last: direction === "prev" ? 50 : null,
          after: direction === "next" ? cursor : null,
          before: direction === "prev" ? cursor : null,
          query: searchQuery,
          sortKey,
          reverse
        }
      }
    );

    const responseJson = await response.json();
    
    // Extract data from response
    const products = responseJson.data.products.edges.map(edge => {
      const product = edge.node;
      // Add cursor information for pagination
      return {
        ...product,
        cursor: edge.cursor,
        formattedPrice: formatPrice(
          product.variants?.edges?.[0]?.node?.price || 
          product.priceRangeV2?.minVariantPrice?.amount || 
          "0",
          product.priceRangeV2?.minVariantPrice?.currencyCode || "USD"
        )
      };
    });

    const pageInfo = responseJson.data.products.pageInfo;

    return json({
      products,
      pageInfo,
      searchQuery,
      sortKey,
      reverse,
      error: null
    });
  } catch (error) {
    console.error("Error fetching products:", error);
    return json({
      products: [],
      pageInfo: null,
      searchQuery: "",
      sortKey: "TITLE",
      reverse: false,
      error: "Failed to load products. Please try again."
    });
  }
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  
  try {
    const formData = await request.formData();
    const action = formData.get("action");

    if (action === "update_product") {
      const productId = formData.get("productId");
      const title = formData.get("title");
      const description = formData.get("description");
      const vendor = formData.get("vendor");
      const productType = formData.get("productType");
      const status = formData.get("status");
      const tags = formData.get("tags");
      
      // Create product input
      const productInput = {
        id: productId,
        title,
        descriptionHtml: description,
        vendor,
        productType,
        status,
        tags: tags.split(',').map(tag => tag.trim()).filter(tag => tag)
      };
      
      // Update the product
      const response = await admin.graphql(
        `#graphql
        mutation updateProduct($input: ProductInput!) {
          productUpdate(input: $input) {
            product {
              id
              title
              descriptionHtml
              vendor
              productType
              status
              tags
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            input: productInput
          }
        }
      );
      
      const responseJson = await response.json();
      
      if (responseJson.data?.productUpdate?.userErrors?.length > 0) {
        return json({
          success: false,
          errors: responseJson.data.productUpdate.userErrors,
          message: "Failed to update product: " + 
            responseJson.data.productUpdate.userErrors.map(e => e.message).join(", ")
        });
      }
      
      return json({
        success: true,
        product: responseJson.data.productUpdate.product,
        message: "Product updated successfully"
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

// Helper function to format price based on currency
function formatPrice(amount, currencyCode) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode,
  }).format(amount);
}

export default function Products() {
  const { products, pageInfo, searchQuery, sortKey, reverse, error } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting" || navigation.state === "loading";

  // State for search and filtering
  const [searchValue, setSearchValue] = useState(searchQuery || "");
  const [currentSortKey, setCurrentSortKey] = useState(sortKey || "TITLE");
  const [isReversed, setIsReversed] = useState(reverse || false);
  
  // State for product editing
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editFormValues, setEditFormValues] = useState({
    title: "",
    description: "",
    vendor: "",
    productType: "",
    status: "ACTIVE",
    tags: ""
  });
  
  // Reset search value when the loader data changes
  useEffect(() => {
    setSearchValue(searchQuery || "");
  }, [searchQuery]);
  
  // Reset sort values when the loader data changes
  useEffect(() => {
    setCurrentSortKey(sortKey || "TITLE");
    setIsReversed(reverse || false);
  }, [sortKey, reverse]);
  
  const handleSearch = useCallback((value) => {
    setSearchValue(value);
  }, []);
  
  const handleSearchSubmit = useCallback(() => {
    // Reset pagination and apply search
    const params = new URLSearchParams();
    if (searchValue) params.set("query", searchValue);
    if (currentSortKey !== "TITLE") params.set("sortKey", currentSortKey);
    if (isReversed) params.set("reverse", "true");
    
    submit(params);
  }, [searchValue, currentSortKey, isReversed, submit]);
  
  const handleSortChange = useCallback((sortKey) => {
    setCurrentSortKey(sortKey);
    
    const params = new URLSearchParams();
    if (searchValue) params.set("query", searchValue);
    params.set("sortKey", sortKey);
    if (isReversed) params.set("reverse", "true");
    
    submit(params);
  }, [searchValue, isReversed, submit]);
  
  const handleReverseToggle = useCallback(() => {
    const newReversedValue = !isReversed;
    setIsReversed(newReversedValue);
    
    const params = new URLSearchParams();
    if (searchValue) params.set("query", searchValue);
    if (currentSortKey !== "TITLE") params.set("sortKey", currentSortKey);
    if (newReversedValue) params.set("reverse", "true");
    
    submit(params);
  }, [searchValue, currentSortKey, isReversed, submit]);
  
  const handlePaginationClick = useCallback((direction, cursor) => {
    const params = new URLSearchParams();
    if (searchValue) params.set("query", searchValue);
    if (currentSortKey !== "TITLE") params.set("sortKey", currentSortKey);
    if (isReversed) params.set("reverse", "true");
    
    params.set("direction", direction);
    if (cursor) params.set("cursor", cursor);
    
    submit(params);
  }, [searchValue, currentSortKey, isReversed, submit]);
  
  const handleEditClick = useCallback((product) => {
    setSelectedProduct(product);
    setEditFormValues({
      title: product.title || "",
      description: product.description || "",
      vendor: product.vendor || "",
      productType: product.productType || "",
      status: product.status || "ACTIVE",
      tags: product.tags?.join(", ") || ""
    });
    setIsEditModalOpen(true);
  }, []);
  
  const handleEditModalClose = useCallback(() => {
    setIsEditModalOpen(false);
    setSelectedProduct(null);
  }, []);
  
  const handleEditFormChange = useCallback((field, value) => {
    setEditFormValues(prev => ({
      ...prev,
      [field]: value
    }));
  }, []);
  
  const handleEditFormSubmit = useCallback(() => {
    if (!selectedProduct) return;
    
    const formData = new FormData();
    formData.append("action", "update_product");
    formData.append("productId", selectedProduct.id);
    formData.append("title", editFormValues.title);
    formData.append("description", editFormValues.description);
    formData.append("vendor", editFormValues.vendor);
    formData.append("productType", editFormValues.productType);
    formData.append("status", editFormValues.status);
    formData.append("tags", editFormValues.tags);
    
    submit(formData, { method: "post" });
    setIsEditModalOpen(false);
  }, [selectedProduct, editFormValues, submit]);
  
  // Handle keyboard press in search input
  const handleKeyPress = useCallback((event) => {
    if (event.key === 'Enter') {
      handleSearchSubmit();
    }
  }, [handleSearchSubmit]);
  
  if (error) {
    return (
      <Page title="Products">
        <Banner status="critical">
          <p>{error}</p>
        </Banner>
      </Page>
    );
  }

  return (
    <Page
      title="Products"
      primaryAction={{
        content: 'Add product',
        url: '/app/products/new',
      }}
    >
      <BlockStack gap="500">
        {actionData?.message && (
          <Banner
            title={actionData.message}
            status={actionData.success ? "success" : "critical"}
            onDismiss={() => {}}
          />
        )}
        
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="500">
                <BlockStack gap="200">
                  <InlineStack gap="200" align="start" blockAlign="center">
                    <div style={{ flexGrow: 1 }}>
                      <TextField
                        label="Search products"
                        value={searchValue}
                        onChange={handleSearch}
                        autoComplete="off"
                        placeholder="Search by title, vendor, product type..."
                        onKeyPress={handleKeyPress}
                        labelHidden
                      />
                    </div>
                    <Button onClick={handleSearchSubmit} disabled={isLoading}>
                      Search
                    </Button>
                  </InlineStack>
                  
                  <InlineStack wrap={false} align="start" gap="200">
                    <Select
                      label="Sort by"
                      labelInline
                      options={[
                        {label: 'Title', value: 'TITLE'},
                        {label: 'Vendor', value: 'VENDOR'},
                        {label: 'Product type', value: 'PRODUCT_TYPE'},
                        {label: 'Created', value: 'CREATED_AT'},
                        {label: 'Updated', value: 'UPDATED_AT'},
                        {label: 'Inventory', value: 'INVENTORY_TOTAL'},
                        {label: 'Price', value: 'PRICE'}
                      ]}
                      value={currentSortKey}
                      onChange={handleSortChange}
                    />
                    <Button 
                      onClick={handleReverseToggle}
                      pressed={isReversed}
                    >
                      {isReversed ? "Descending" : "Ascending"}
                    </Button>
                  </InlineStack>
                </BlockStack>
                
                {isLoading ? (
                  <div style={{ textAlign: "center", padding: "2rem" }}>
                    <Spinner size="large" />
                  </div>
                ) : products.length === 0 ? (
                  <EmptyState
                    heading="No products found"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>Try changing your search or filter criteria.</p>
                  </EmptyState>
                ) : (
                  <>
                    <ResourceList
                      items={products}
                      renderItem={(product) => {
                        const { id, title, vendor, productType, status, formattedPrice, featuredImage, tags } = product;
                        const media = (
                          <Thumbnail
                            source={featuredImage?.url || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-product-1.png"}
                            alt={featuredImage?.altText || title}
                          />
                        );
                        
                        return (
                          <ResourceList.Item
                            id={id}
                            media={media}
                            accessibilityLabel={`View details for ${title}`}
                            shortcutActions={[
                              {
                                content: 'Edit',
                                accessibilityLabel: `Edit ${title}`,
                                onClick: () => handleEditClick(product),
                              },
                              {
                                content: 'View',
                                accessibilityLabel: `View ${title}`,
                                url: `/app/products/${id.split('/').pop()}`,
                              },
                            ]}
                          >
                            <BlockStack gap="100">
                              <Text variant="bodyMd" fontWeight="bold" as="h3">
                                {title}
                              </Text>
                              
                              <InlineStack gap="300">
                                <Text variant="bodySm" color="subdued">
                                  {formattedPrice}
                                </Text>
                                {vendor && (
                                  <Text variant="bodySm" color="subdued">
                                    Vendor: {vendor}
                                  </Text>
                                )}
                                {productType && (
                                  <Text variant="bodySm" color="subdued">
                                    Type: {productType}
                                  </Text>
                                )}
                                <Text variant="bodySm" color="subdued">
                                  Status: {status.toLowerCase()}
                                </Text>
                              </InlineStack>
                              
                              {tags && tags.length > 0 && (
                                <div style={{ marginTop: '8px' }}>
                                  {tags.slice(0, 3).map((tag) => (
                                    <Tag key={tag}>{tag}</Tag>
                                  ))}
                                  {tags.length > 3 && (
                                    <Tag>+{tags.length - 3} more</Tag>
                                  )}
                                </div>
                              )}
                            </BlockStack>
                          </ResourceList.Item>
                        );
                      }}
                    />
                    
                    <div style={{ marginTop: '20px' }}>
                      <Pagination
                        hasPrevious={pageInfo.hasPreviousPage}
                        onPrevious={() => handlePaginationClick('prev', pageInfo.startCursor)}
                        hasNext={pageInfo.hasNextPage}
                        onNext={() => handlePaginationClick('next', pageInfo.endCursor)}
                      />
                    </div>
                  </>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
      
      <Modal
        open={isEditModalOpen}
        onClose={handleEditModalClose}
        title="Edit Product"
        primaryAction={{
          content: "Save",
          onAction: handleEditFormSubmit,
          loading: isLoading,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: handleEditModalClose,
          },
        ]}
      >
        <Modal.Section>
          <FormLayout>
            <TextField
              label="Title"
              value={editFormValues.title}
              onChange={(value) => handleEditFormChange('title', value)}
              autoComplete="off"
              requiredIndicator
            />
            
            <TextField
              label="Description"
              value={editFormValues.description}
              onChange={(value) => handleEditFormChange('description', value)}
              autoComplete="off"
              multiline={4}
            />
            
            <TextField
              label="Vendor"
              value={editFormValues.vendor}
              onChange={(value) => handleEditFormChange('vendor', value)}
              autoComplete="off"
            />
            
            <TextField
              label="Product Type"
              value={editFormValues.productType}
              onChange={(value) => handleEditFormChange('productType', value)}
              autoComplete="off"
            />
            
            <Select
              label="Status"
              options={[
                {label: 'Active', value: 'ACTIVE'},
                {label: 'Draft', value: 'DRAFT'},
                {label: 'Archived', value: 'ARCHIVED'}
              ]}
              value={editFormValues.status}
              onChange={(value) => handleEditFormChange('status', value)}
            />
            
            <TextField
              label="Tags"
              value={editFormValues.tags}
              onChange={(value) => handleEditFormChange('tags', value)}
              autoComplete="off"
              helpText="Separate tags with commas"
            />
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
} 