import * as Polaris from '@shopify/polaris';

const {
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
  Select,
  RadioButton,
  Checkbox,
  Pagination,
  Icon,
  ButtonGroup,
  Tooltip,
  Box,
  Divider,
  Toast,
  Frame,
  FormLayout,
} = Polaris;
import { useState, useCallback, useEffect } from "react";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useSubmit, useNavigate, useNavigation, useParams, Link, useSearchParams } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { PlusIcon, MinusIcon, SearchIcon, XIcon, FilterIcon, CollectionIcon } from "@shopify/polaris-icons";
import CollectionImageUpload from '../components/CollectionImageUpload';

// Add a helper to fetch all collections with pagination
async function fetchAllCollections(admin, query, variables = {}) {
  let allCollections = [];
  let hasNextPage = true;
  let after = null;
  while (hasNextPage) {
    const response = await admin.graphql(query, {
      variables: { ...variables, first: 100, after }
    });
    const json = await response.json();
    const edges = json.data.collections.edges;
    allCollections.push(...edges.map(edge => edge.node));
    hasNextPage = json.data.collections.pageInfo.hasNextPage;
    after = json.data.collections.pageInfo.endCursor;
  }
  return allCollections;
}

// Add a helper to fetch all products in a collection with pagination
async function fetchAllCollectionProducts(admin, collectionId) {
  let allProducts = [];
  let hasNextPage = true;
  let after = null;
  while (hasNextPage) {
    const response = await admin.graphql(
      `#graphql
      query GetCollectionProducts($id: ID!, $first: Int!, $after: String) {
        collection(id: $id) {
          products(first: $first, after: $after) {
            edges { node { id title handle featuredImage { url altText } status vendor productType tags createdAt priceRangeV2 { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } } } cursor }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { variables: { id: `gid://shopify/Collection/${collectionId}`, first: 100, after } }
    );
    const json = await response.json();
    const edges = json.data.collection.products.edges;
    allProducts.push(...edges.map(edge => edge.node));
    hasNextPage = json.data.collection.products.pageInfo.hasNextPage;
    after = json.data.collection.products.pageInfo.endCursor;
  }
  return allProducts;
}

export const loader = async ({ request, params }) => {
  const { admin } = await authenticate.admin(request);
  const { collectionId } = params;
  
  // Check if this is a refetch request
  const url = new URL(request.url);
  const isRefetch = url.searchParams.get("_action") === "refetch";
  const parentIdFromURL = url.searchParams.get("parentId");
  
  try {
    // Fetch collection details
    const collectionResponse = await admin.graphql(
      `#graphql
      query GetCollection($id: ID!) {
        collection(id: $id) {
          id
          title
          handle
          descriptionHtml
          image {
            id
            url
            altText
          }
          ruleSet {
            rules {
              column
              condition
              relation
            }
            appliedDisjunctively
          }
          metafields(first: 20) {
            edges {
              node {
                id
                namespace
                key
                value
                type
                references(first: 20) {
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
      }`,
      {
        variables: {
          id: `gid://shopify/Collection/${collectionId}`,
        },
      }
    );

    const collectionJson = await collectionResponse.json();
    const collection = collectionJson.data.collection;

    // Fetch all collections for parent selection
    const collections = await fetchAllCollections(
      admin,
      `#graphql
        query GetAllCollections($first: Int!, $after: String) {
          collections(first: $first, after: $after) {
            edges {
              node {
                id
                title
                handle
                image { url }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      `
    );

    // Fetch products in the collection
    const products = await fetchAllCollectionProducts(admin, collectionId);
    const pageInfo = { hasNextPage: false, endCursor: null };

    // Extract subcategories from metafields
    const subcategoriesMetafield = collection.metafields.edges.find(
      edge => edge.node.namespace === "custom" && edge.node.key === "subcat"
    );
    
    let subcategories = [];
    if (subcategoriesMetafield && subcategoriesMetafield.node.references) {
      subcategories = subcategoriesMetafield.node.references.edges.map(edge => edge.node);
    }

    // Determine if this is a smart collection
    const isSmartCollection = collection.ruleSet && collection.ruleSet.rules.length > 0;
    
    // Debug logs to verify the ruleSet data
    console.log("Collection ruleSet:", collection.ruleSet);
    console.log("Is disjunctive (OR condition):", collection.ruleSet?.appliedDisjunctively);
    
    // Fetch Online Store publication ID
    const publicationsResponse = await admin.graphql(
      `#graphql
      query GetPublications {
        publications(first: 10) {
          edges {
            node {
              id
              name
            }
          }
        }
      }
      `
    );
    const publicationsJson = await publicationsResponse.json();
    const onlineStorePublication = (publicationsJson.data.publications.edges || []).find(
      edge => edge.node.name === "Online Store"
    );
    const onlineStorePublicationId = onlineStorePublication?.node?.id || null;
    
    // In loader, extract parent_collection metafield and normalize to GID format
    const parentMetafield = collection.metafields.edges.find(
      edge => edge.node.namespace === "custom" && edge.node.key === "parent_collection"
    );
    let parentCollectionId = parentIdFromURL;
    if (parentMetafield && parentMetafield.node.value) {
      // If already a GID, use as is. If just a number, convert to GID.
      const val = parentMetafield.node.value;
      if (val.startsWith("gid://shopify/Collection/")) {
        parentCollectionId = val;
      } else if (/^\d+$/.test(val)) {
        parentCollectionId = `gid://shopify/Collection/${val}`;
      } else {
        parentCollectionId = val; // fallback, may still work
      }
    }
    
    // Debug log for parent collection
    // console.log("[DEBUG] parentCollectionId:", parentCollectionId);
    // console.log("[DEBUG] collections IDs:", collections.map(c => c.id));
    
    // In loader, fetch the collection type and pass it to the client
    const collectionTypeShopify = collection?.__typename || collection?.type || (collection.ruleSet && collection.ruleSet.rules.length > 0 ? 'SMART' : 'CUSTOM');
    
    return json({
      collection,
      collections,
      products,
      pageInfo,
      isSmartCollection,
      collectionTypeShopify, // pass to client
      subcategories,
      subcategoriesMetafieldId: subcategoriesMetafield?.node?.id || null,
      parentCollectionId, // Pass to client
      onlineStorePublicationId, // Pass to client
      error: null
    });
  } catch (error) {
    console.error("Error fetching collection:", error);
    return json({
      collection: null,
      collections: [],
      products: [],
      pageInfo: null,
      isSmartCollection: false,
      subcategories: [],
      subcategoriesMetafieldId: null,
      parentCollectionId: null,
      onlineStorePublicationId: null,
      error: "Failed to load collection. Please try again."
    });
  }
};

export const action = async ({ request, params }) => {
  const { admin } = await authenticate.admin(request);
  const { collectionId } = params;
  
  try {
    // Check if it's a GET request with action parameter
    const url = new URL(request.url);
    const actionFromQuery = url.searchParams.get("action");
    
    // Handle the action based on the request type
    let actionName;
    let requestBody = {};
    
    if (request.method === "GET" && actionFromQuery) {
      actionName = actionFromQuery;
    } else {
      // Handle POST request
      const contentType = request.headers.get("content-type") || "";
      
      if (contentType.includes("application/json")) {
        requestBody = await request.json();
        actionName = requestBody.action;
      } else {
        const formData = await request.formData();
        actionName = formData.get("action");
        requestBody = Object.fromEntries(formData.entries());
      }
    }

    if (actionName === "get_all_collections") {
      try {
        // Fetch all collections
        const response = await admin.graphql(
          `#graphql
          query GetAllCollections {
            collections(first: 100) {
              edges {
                node {
                  id
                  title
                  handle
                  image {
                    url
                  }
                }
              }
            }
          }`
        );
        
        const responseJson = await response.json();
        const collections = (responseJson.data.collections?.edges || []).map(edge => edge.node);
        
        // Filter out the current collection
        const filteredCollections = collections.filter(c => 
          c.id !== `gid://shopify/Collection/${collectionId}`
        );
        
        return json({
          success: true,
          collections: filteredCollections
        });
      } catch (error) {
        console.error("Error fetching collections:", error);
        return json({
          success: false,
          message: "Error fetching collections: " + error.message
        }, { status: 500 });
      }
    }
    
    if (actionName === "update_collection") {
      const title = requestBody.title;
      const description = requestBody.description;
      const imageUrl = requestBody.imageUrl;
      const parentCollectionId = requestBody.parentCollectionId;
      const collectionType = requestBody.collectionType; // 'SMART' or 'CUSTOM'
      let onlineStorePublicationId = requestBody.onlineStorePublicationId;
      const collectionInput = {
        id: `gid://shopify/Collection/${collectionId}`,
        title,
        descriptionHtml: description,
      };
      if (imageUrl && typeof imageUrl === 'string' && imageUrl.trim().startsWith('http')) {
        collectionInput.image = { src: imageUrl };
      }
      // --- SMART COLLECTION ---
      if (collectionType === "SMART") {
        try {
          const rules = requestBody.rules ? JSON.parse(requestBody.rules) : [];
          if (!rules.length) {
            return json({ success: false, message: "You must add at least one rule to use Smart Collection." });
          }
          // Validate all rules
          const validRules = rules.filter(r => r.column && r.relation && r.condition);
          if (!validRules.length) {
            return json({ success: false, message: "All rules must have column, relation, and condition." });
          }
          const globalCondition = requestBody.globalCondition || "AND";
          collectionInput.ruleSet = {
            rules: validRules,
            appliedDisjunctively: globalCondition === 'OR'
          };
          // Debug log for ruleSet payload
          console.log('[DEBUG] Submitting ruleSet to Shopify:', JSON.stringify(collectionInput.ruleSet, null, 2));
        } catch (e) {
          return json({ success: false, message: "Invalid rules format: " + e.message });
        }
      }
      // --- MANUAL COLLECTION ---
      if (collectionType === "CUSTOM") {
        collectionInput.ruleSet = null;
        console.log('[DEBUG] Clearing ruleSet for manual collection');
      }
      // ... existing code for update mutation ...
      // Only fetch publicationId if not present
      if (!onlineStorePublicationId) {
        const publicationsResponse = await admin.graphql(
          `#graphql
          query GetPublications {
            publications(first: 10) {
              edges { node { id name } }
            }
          }`
        );
        const publicationsJson = await publicationsResponse.json();
        const onlineStorePublication = (publicationsJson.data.publications.edges || []).find(
          edge => edge.node.name === "Online Store"
        );
        onlineStorePublicationId = onlineStorePublication?.node?.id || null;
      }
      // Update the collection in one mutation
      const response = await admin.graphql(
        `#graphql
        mutation updateCollection($input: CollectionInput!) {
          collectionUpdate(input: $input) {
            collection {
              id
              title
              handle
              image { url }
              ruleSet { rules { column relation condition  } appliedDisjunctively }
            }
            userErrors { field message }
          }
        }`,
        { variables: { input: collectionInput } }
      );
      const responseJson = await response.json();
      // Debug log for GraphQL response
      console.log('[DEBUG] Shopify collectionUpdate response:', JSON.stringify(responseJson, null, 2));
      if (responseJson.data?.collectionUpdate?.userErrors?.length > 0) {
        return json({
          success: false,
          errors: responseJson.data.collectionUpdate.userErrors,
          message: "Failed to update collection: " + responseJson.data.collectionUpdate.userErrors.map(e => e.message).join(", ")
        });
      }
      // Metafield logic (parent assignment) remains unchanged
      // ... existing code ...
      // Product assignment for manual collections remains unchanged
      // ... existing code ...
      // After successful update, publish to Online Store if publicationId is available
      if (onlineStorePublicationId) {
        try {
          await admin.graphql(
            `#graphql
            mutation publishCollection($id: ID!, $publicationId: ID!) {
              publishablePublish(id: $id, input: [{ publicationId: $publicationId }]) {
                publishable { publishedOnPublication(publicationId: $publicationId) }
                userErrors { field message }
              }
            }`,
            {
              variables: {
                id: `gid://shopify/Collection/${collectionId}`,
                publicationId: onlineStorePublicationId
              }
            }
          );
        } catch (e) {
          // Log but do not fail the main update
          console.error('Publication error:', e);
        }
      }
      // Refetch the latest collection after update
      const updatedCollectionResp = await admin.graphql(
        `#graphql
        query GetCollection($id: ID!) {
          collection(id: $id) {
            id
            title
            handle
            descriptionHtml
            image { id url altText }
            ruleSet { rules { column condition relation } appliedDisjunctively }
            products(first: 50) { edges { node { id title featuredImage { url altText } } } }
            metafields(first: 20) {
              edges {
                node {
                  id
                  namespace
                  key
                  value
                  type
                  references(first: 20) {
                    edges {
                      node {
                        ... on Collection {
                          id
                          title
                          handle
                          image { url }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }`,
        { variables: { id: `gid://shopify/Collection/${collectionId}` } }
      );
      const updatedCollectionJson = await updatedCollectionResp.json();
      const updatedCollection = updatedCollectionJson.data.collection;
      return json({
        success: true,
        message: "Collection updated successfully",
        collection: updatedCollection
      });
    }
    else if (actionName === "update_subcategories") {
      // Get the subcategory IDs to save
      const subcategoryIds = JSON.parse(requestBody.subcategoryIds || "[]");
      const metafieldId = requestBody.metafieldId;
      
      try {
        if (metafieldId) {
          // Update existing metafield
          const response = await admin.graphql(
            `#graphql
            mutation updateSubcategoriesMetafield($metafields: [MetafieldsSetInput!]!) {
              metafieldsSet(metafields: $metafields) {
                metafields {
                  id
                  namespace
                  key
                  value
                }
                userErrors {
                  field
                  message
                }
              }
            }`,
            {
              variables: {
                metafields: [
                  {
                    namespace: "custom",
                    key: "subcat",
                    ownerId: `gid://shopify/Collection/${collectionId}`,
                    value: JSON.stringify(subcategoryIds),
                    type: "list.collection_reference" // 🛑 IMPORTANT - ADD THIS
                  }
                ]
              }
            }
          );
          const responseJson = await response.json();
          
          if (responseJson.data?.metafieldsSet?.userErrors?.length > 0) {
            return json({
              success: false,
              message: "Failed to update subcategories: " + 
                responseJson.data.metafieldsSet.userErrors.map(e => e.message).join(", ")
            });
          }
        } else if (subcategoryIds.length > 0) {
          // Create new metafield with proper value format
          const response = await admin.graphql(
            `#graphql
            mutation createSubcategoriesMetafield($metafields: [MetafieldsSetInput!]!) {
              metafieldsSet(metafields: $metafields) {
                metafields {
                  id
                  namespace
                  key
                  value
                }
                userErrors {
                  field
                  message
                }
              }
            }`,
            {
              variables: {
                metafields: [
                  {
                    namespace: "custom",
                    key: "subcat",
                    ownerId: `gid://shopify/Collection/${collectionId}`,
                    type: "list.collection_reference",
                    value: JSON.stringify(subcategoryIds),
                  }
                ]
              }
            }
          );
          
          
          const responseJson = await response.json();
          
          if (responseJson.data?.metafieldsSet?.userErrors?.length > 0) {
            return json({
              success: false,
              message: "Failed to create subcategories metafield: " + 
                responseJson.data.metafieldsSet.userErrors.map(e => e.message).join(", ")
            });
          }
        }
        
        // After updating, fetch the updated collection to return the latest data
        const collectionResponse = await admin.graphql(
          `#graphql
          query GetUpdatedCollection($id: ID!) {
            collection(id: $id) {
              id
              metafields(first: 10, namespace: "custom") {
                edges {
                  node {
                    id
                    namespace
                    key
                    value
                    type
                    references(first: 20) {
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
          }`,
          {
            variables: {
              id: `gid://shopify/Collection/${collectionId}`,
            },
          }
        );
        
        const collectionJson = await collectionResponse.json();
        const metafield = collectionJson.data.collection.metafields.edges[0]?.node;
        
        // Extract subcategories
        let subcategories = [];
        if (metafield && metafield.references) {
          subcategories = metafield.references.edges.map(edge => edge.node);
        }
        
        return json({
          success: true,
          message: "Subcategories updated successfully",
          subcategories,
          metafieldId: metafield?.id || null
        });
      } catch (error) {
        console.error("Error updating subcategories:", error);
        return json({
          success: false,
          message: "Error updating subcategories: " + error.message
        });
      }
    }
    else if (actionName === "remove_subcategory") {
      // Get the subcategory ID to remove
      const subcategoryId = requestBody.subcategoryId;
      const metafieldId = requestBody.metafieldId;
      const existingReferences = JSON.parse(requestBody.existingReferences || "[]");
      
      if (!subcategoryId || !metafieldId) {
        return json({
          success: false,
          message: "Missing subcategory ID or metafield ID for removal"
        });
      }
      
      // Filter out the subcategory from the existing references
      const updatedReferences = existingReferences.filter(id => id !== subcategoryId);
      
      try {
        // Update the metafield
        const response = await admin.graphql(
          `#graphql
          mutation updateSubcategoriesMetafield($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              metafields {
                id
                namespace
                key
                value
              }
              userErrors {
                field
                message
              }
            }
          }`,
          {
            variables: {
              metafields: [
                {
                  namespace: "custom", // 🔥 Mandatory
                  key: "subcat",        // 🔥 Mandatory
                  ownerId: `gid://shopify/Collection/${collectionId}`, // 🔥 Mandatory
                  type: "list.collection_reference",  // 🔥 Mandatory
                  value: JSON.stringify(updatedReferences) // 🔥 Updated list
                }
              ]
            }
          }
        );
        
        
        const responseJson = await response.json();
        
        if (responseJson.data?.metafieldsSet?.userErrors?.length > 0) {
          return json({
            success: false,
            message: "Failed to update subcategories: " + 
              responseJson.data.metafieldsSet.userErrors.map(e => e.message).join(", ")
          });
        }
        
        return json({
          success: true,
          message: "Subcategory removed successfully"
        });
      } catch (error) {
        console.error("Error removing subcategory:", error);
        return json({
          success: false,
          message: "Error removing subcategory: " + error.message
        });
      }
    }
    else if (actionName === "search_collections") {
      // Get search query
      const searchQuery = requestBody.searchQuery || "";
      
      // Search for collections
      const response = await admin.graphql(
        `#graphql
        query searchCollections($query: String!) {
          collections(first: 10, query: $query) {
            edges {
              node {
                id
                title
                handle
                image {
                  url
                }
              }
            }
          }
        }`,
        {
          variables: {
            query: searchQuery
          }
        }
      );
      
      const responseJson = await response.json();
      const searchResults = responseJson.data.collections.edges.map(edge => edge.node);
      
      return json({
        success: true,
        collections: searchResults
      });
    }
    else if (actionName === "remove_product") {
      // Get the product ID to remove
      const productId = requestBody.productId;
      
      if (!productId) {
        return json({
          success: false,
          message: "No product ID provided for removal"
        });
      }
      
      // Remove the product from the collection
      const response = await admin.graphql(
        `#graphql
        mutation removeProductFromCollection($id: ID!, $productIds: [ID!]!) {
          collectionRemoveProducts(id: $id, productIds: $productIds) {
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            id: `gid://shopify/Collection/${collectionId}`,
            productIds: [productId]
          }
        }
      );
      
      const responseJson = await response.json();
      
      if (responseJson.data?.collectionRemoveProducts?.userErrors?.length > 0) {
        return json({
          success: false,
          message: "Failed to remove product: " + 
            responseJson.data.collectionRemoveProducts.userErrors.map(e => e.message).join(", ")
        });
      }
      
      return json({
        success: true,
        message: "Product removed from collection"
      });
    }
    else if (actionName === "add_products") {
      // Get the product IDs to add
      const productIdsJson = requestBody.productIds;
      
      if (!productIdsJson) {
        return json({
          success: false,
          message: "No product IDs provided for adding"
        });
      }
      
      // Parse the product IDs
      const productIds = JSON.parse(productIdsJson);
      
      if (!Array.isArray(productIds) || productIds.length === 0) {
        return json({
          success: false,
          message: "No valid product IDs provided"
        });
      }
      
      // Add the products to the collection
      const response = await admin.graphql(
        `#graphql
        mutation addProductsToCollection($id: ID!, $productIds: [ID!]!) {
          collectionAddProducts(id: $id, productIds: $productIds) {
            collection {
              id
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            id: `gid://shopify/Collection/${collectionId}`,
            productIds: productIds
          }
        }
      );
      
      const responseJson = await response.json();
      
      if (responseJson.data?.collectionAddProducts?.userErrors?.length > 0) {
        return json({
          success: false,
          message: "Failed to add products: " + 
            responseJson.data.collectionAddProducts.userErrors.map(e => e.message).join(", ")
        });
      }
      
      return json({
        success: true,
        message: `${productIds.length} products added to collection`
      });
    }
    else if (actionName === "create_subcategory") {
      const title = requestBody.title;
      const description = requestBody.description || "";
      const imageUrl = requestBody.imageUrl || "";
      // The parent collection is the current collectionId
      const parentId = `gid://shopify/Collection/${collectionId}`;
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

export default function EditCollection() {
  const { collection, collections, products, pageInfo, isSmartCollection, collectionTypeShopify, subcategories, subcategoriesMetafieldId, parentCollectionId: loaderParentCollectionId, onlineStorePublicationId, error } = useLoaderData();
  console.log("collection", collection);
  const actionData = useActionData();
  const submit = useSubmit();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";
  const { collectionId } = useParams();
  const [searchParams] = useSearchParams();
  
  // Extract return URL and focus parameters
  const returnTo = searchParams.get("returnTo");
  const focusSubcategories = searchParams.get("focusSubcategories") === "true";

  // State for form fields
  const [title, setTitle] = useState(collection?.title || "");
  const [description, setDescription] = useState(collection?.descriptionHtml || "");
  const [imageUrl, setImageUrl] = useState(collection?.image?.url || "");
  const [parentCollectionId, setParentCollectionId] = useState(loaderParentCollectionId || "");
  const [collectionType, setCollectionType] = useState(isSmartCollection ? "smart" : "manual");
  const [isImageProcessing, setIsImageProcessing] = useState(false);
  
  // State for subcategories management
  const [subcategoriesList, setSubcategoriesList] = useState(subcategories || []);
  const [isSubcatModalOpen, setIsSubcatModalOpen] = useState(false);
  const [isCreateSubcatModalOpen, setIsCreateSubcatModalOpen] = useState(false);
  const [subcatSearchQuery, setSubcatSearchQuery] = useState("");
  const [subcatSearchResults, setSubcatSearchResults] = useState([]);
  const [isSearchingSubcats, setIsSearchingSubcats] = useState(false);
  const [selectedSubcats, setSelectedSubcats] = useState({});
  
  // State for new subcategory creation
  const [newSubcatTitle, setNewSubcatTitle] = useState("");
  const [newSubcatDescription, setNewSubcatDescription] = useState("");
  const [newSubcatImageUrl, setNewSubcatImageUrl] = useState("");
  const [isCreatingSubcat, setIsCreatingSubcat] = useState(false);
  
  // State for product selection
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [sortOption, setSortOption] = useState("best_selling");
  
  // State for smart collection rules
  const [rules, setRules] = useState(
    (collection?.ruleSet?.rules || []).map(rule => ({
      ...rule,
      value: rule.condition // Store the condition value in the UI value field
    }))
  );
  
  // State for browse modal
  const [isBrowseModalOpen, setIsBrowseModalOpen] = useState(false);
  const [allProducts, setAllProducts] = useState([]);
  const [isLoadingAllProducts, setIsLoadingAllProducts] = useState(false);
  const [browseSearchQuery, setBrowseSearchQuery] = useState("");
  const [checkedProducts, setCheckedProducts] = useState({});
  const [filterValue, setFilterValue] = useState({});
  
  // State for preview products that match rules
  const [previewProducts, setPreviewProducts] = useState(products || []);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  
  // Add toast state
  const [activeToast, setActiveToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  
  // State for global condition - initialize based on collection's appliedDisjunctively property
  const [globalCondition, setGlobalCondition] = useState(() => {
    if (collection && collection.ruleSet) {
      return collection.ruleSet.appliedDisjunctively ? 'OR' : 'AND';
    }
    return 'AND';
  });

  // --- Add effect to log changes and update current setting text ---
  useEffect(() => {
    console.log('[DEBUG] globalCondition changed:', globalCondition);
    console.log('[DEBUG] Current ruleSet:', rules);
  }, [globalCondition, rules]);

  // Helper for current setting text
  const currentSettingText = globalCondition === 'OR'
    ? 'Current setting from Shopify: Products can match any condition'
    : 'Current setting from Shopify: Products must match all conditions';

  // State for banner
  const [showBanner, setShowBanner] = useState(true);
  
  // Debug: Log the globalCondition value and collection.ruleSet
  useEffect(() => {
    console.log('Collection data:', collection);
  }, [collection, globalCondition]);
  
  // Update subcategories list and collection state when action data changes
  useEffect(() => {
    if (actionData?.success) {
      // If we have updated subcategories from the server, update the UI
      if (actionData.subcategories) {
        setSubcategoriesList(actionData.subcategories);
      } 
      // Only add a single subcategory if we don't have the full list
      else if (actionData.subcategory) {
        setSubcategoriesList(prev => [...prev, actionData.subcategory]);
      }
      // If we have a new metafield ID, update the state
      if (actionData.metafieldId && actionData.metafieldId !== subcategoriesMetafieldId) {
        if (typeof window !== 'undefined') {
          const formData = new FormData();
          formData.append("_action", "refetch");
          submit(formData, { method: "get", replace: true });
        }
      }
      // If collection type or rules were updated, update UI state
      if (actionData.collection) {
        // Update collectionType and shopifyType
        const isNowSmart = actionData.collection.ruleSet && actionData.collection.ruleSet.rules.length > 0;
        setCollectionType(isNowSmart ? "smart" : "manual");
        setShopifyType(isNowSmart ? 'SMART' : 'CUSTOM');
        setSmartState(isNowSmart);
        // Update rules and globalCondition
        if (isNowSmart) {
          setRules((actionData.collection.ruleSet.rules || []).map(rule => ({ ...rule, value: rule.condition })));
          setGlobalCondition(actionData.collection.ruleSet.appliedDisjunctively ? 'OR' : 'AND');
        } else {
          setRules([]);
        }
        // Update preview products if smart
        if (isNowSmart && actionData.collection.products) {
          setPreviewProducts(actionData.collection.products);
        }
      }
      // Show success message
      if (actionData.message) {
        showToast(actionData.message);
      }
    } else if (actionData?.success === false && actionData?.message) {
      showToast(actionData.message);
    }
  }, [actionData, subcategoriesMetafieldId, submit]);
  
  // Handle toast visibility
  const toggleActiveToast = useCallback(() => setActiveToast((active) => !active), []);
  
  // Show toast with message
  const showToast = useCallback((message) => {
    setToastMessage(message);
    setActiveToast(true);
  }, []);

  // Update product preview when rules change
  useEffect(() => {
    // Only run if we have valid rules in smart collection mode
    if (collectionType === "smart" && rules.length > 0 && rules.some(rule => rule.condition?.trim())) {
      const previewRules = async () => {
        setIsPreviewLoading(true);
        try {
          // Prepare the rules for preview query
          const apiRules = rules.map(({ column, condition, relation }) => ({
            column, condition, relation
          })).filter(rule => rule.condition?.trim()); // Filter out empty rules
          
          if (apiRules.length === 0) {
            setPreviewProducts([]);
            return;
          }
          
          const response = await fetch(`/api/collections/preview-rules`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              rules: apiRules,
              collectionId,
              globalCondition
            })
          });
          
          if (!response.ok) {
            throw new Error('Failed to preview products');
          }
          
          const data = await response.json();
          setPreviewProducts(data.products || []);
        } catch (error) {
          console.error("Error previewing products:", error);
          // Keep existing products on error
        } finally {
          setIsPreviewLoading(false);
        }
      };
      
      // Debounce the preview call to avoid too many requests
      const timeoutId = setTimeout(previewRules, 500);
      return () => clearTimeout(timeoutId);
    }
  }, [rules, collectionType, collectionId, globalCondition]);
  
  // Initialize selected products from the collection
  useEffect(() => {
    if (products && products.length > 0) {
      setSelectedProducts(products.map(product => product.id));
      
      // Also initialize the checked products map for the browse modal
      const initialChecked = {};
      products.forEach(product => {
        initialChecked[product.id] = true;
      });
      setCheckedProducts(initialChecked);
    }
  }, [products]);
  
  // Initialize parent collection from metafields
  useEffect(() => {
    if (collection?.metafields?.edges) {
      const parentMetafield = collection.metafields.edges.find(
        edge => edge.node.namespace === "custom" && edge.node.key === "parent_collection"
      );
      
      if (parentMetafield) {
        setParentCollectionId(parentMetafield.node.value);
      }
    }
  }, [collection]);

  // Subcategory handlers
  const handleOpenSubcatModal = async () => {
    setIsSubcatModalOpen(true);
    // Reset search state
    setSubcatSearchQuery("");
    setIsSearchingSubcats(true);
    
    // Initialize selected state with current subcategories
    const initialSelected = {};
    subcategoriesList.forEach(subcat => {
      initialSelected[subcat.id] = true;
    });
    setSelectedSubcats(initialSelected);
    
    try {
      // Use a direct JSON API approach instead of FormData
      const response = await fetch(`/api/collections/${collectionId}/get-all`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}: ${response.statusText}`);
      }
      
      const responseData = await response.json();
      if (responseData.collections) {
        setSubcatSearchResults(responseData.collections);
      } else {
        throw new Error(responseData.message || "Failed to fetch collections");
      }
    } catch (error) {
      console.error("Error fetching collections:", error);
      showToast("Error loading collections: " + error.message);
      
      // Fallback: Load collections from props to prevent empty modal
      const filteredCollections = collections.filter(c => 
        c.id !== `gid://shopify/Collection/${collectionId}`
      );
      setSubcatSearchResults(filteredCollections);
    } finally {
      setIsSearchingSubcats(false);
    }
  };
  
  const handleSubcatCheck = (subcatId) => {
    setSelectedSubcats(prev => ({
      ...prev,
      [subcatId]: !prev[subcatId]
    }));
  };
  
  const handleApplySelectedSubcats = () => {
    // Get all selected subcategory IDs
    const selectedIds = Object.keys(selectedSubcats).filter(id => selectedSubcats[id]);
    
    // Update the UI with loading state
    showToast("Updating subcategories...");
    setIsSubcatModalOpen(false);
    
    // Update subcategories on the server
    const formData = new FormData();
    formData.append("action", "update_subcategories");
    formData.append("subcategoryIds", JSON.stringify(selectedIds));
    formData.append("metafieldId", subcategoriesMetafieldId || "");
    
    // Submit the form and handle the response
    submit(formData, { method: "post" });
  };
  
  const handleCreateSubcategory = () => {
    if (!newSubcatTitle.trim() || !newSubcatType) {
      showToast("Subcategory title and type are required");
      return;
    }
    if (newSubcatType === "smart") {
      const validRules = newSubcatRules.filter(r => r.column && r.relation && (r.value || r.condition));
      if (!validRules.length) {
        showToast("You must add at least one complete rule for a Smart Subcategory.");
        return;
      }
    }
    setIsCreatingSubcat(true);
    const formData = new FormData();
    formData.append("action", "create_subcategory");
    formData.append("title", newSubcatTitle);
    formData.append("description", newSubcatDescription);
    formData.append("imageUrl", newSubcatImageUrl);
    formData.append("metafieldId", subcategoriesMetafieldId || "");
    formData.append("subcatType", newSubcatType === "smart" ? "SMART" : "CUSTOM");
    if (newSubcatType === "smart") {
      const validRules = newSubcatRules.filter(r => r.column && r.relation && (r.value || r.condition));
      const apiRules = validRules.map(({ column, relation, value, condition }) => ({
        column,
        relation,
        condition: value !== undefined ? value : condition
      }));
      const ruleSet = {
        rules: apiRules,
        appliedDisjunctively: newSubcatGlobalCondition === 'OR'
      };
      formData.append("ruleSet", JSON.stringify(ruleSet));
    }
    submit(formData, { method: "post" });
    setIsCreateSubcatModalOpen(false);
    setIsCreatingSubcat(false);
    setNewSubcatTitle("");
    setNewSubcatDescription("");
    setNewSubcatImageUrl("");
    setNewSubcatType("");
    setNewSubcatRules([{ column: "TITLE", relation: "EQUALS", condition: "", value: "" }]);
    setNewSubcatGlobalCondition("AND");
    showToast("Creating subcategory...");
    if (returnTo && focusSubcategories) {
      setTimeout(() => {
        navigate(`${returnTo}?fromCollectionId=${collectionId}&refresh=true`);
      }, 1500);
    }
  };
  
  const handleRemoveSubcategory = (subcatId) => {
    // Filter out the subcategory from the UI list
    const updatedSubcats = subcategoriesList.filter(subcat => subcat.id !== subcatId);
    setSubcategoriesList(updatedSubcats);
    
    // Prepare existing references for metafield update
    const existingReferences = subcategoriesList.map(subcat => subcat.id);
    
    // Remove the subcategory on the server
    const formData = new FormData();
    formData.append("action", "remove_subcategory");
    formData.append("subcategoryId", subcatId);
    formData.append("metafieldId", subcategoriesMetafieldId || "");
    formData.append("existingReferences", JSON.stringify(existingReferences));
    
    submit(formData, { method: "post" });
    
    showToast("Subcategory removed");
  };
  
  const handleSubcatSearchKeyPress = (event) => {
    if (event.key === 'Enter') {
      handleSearchSubcategories();
    }
  };

  const handleUpdateCollection = () => {
    if (isImageProcessing) {
      showToast('Please wait for the image upload to finish.');
      return;
    }
    const formData = new FormData();
    formData.append("action", "update_collection");
    formData.append("title", title);
    formData.append("description", description);
    formData.append("collectionType", collectionType === 'smart' ? 'SMART' : 'CUSTOM');
    if (imageUrl) {
      formData.append("imageUrl", imageUrl);
    }
    if (parentCollectionId) {
      formData.append("parentCollectionId", parentCollectionId);
    }
    // --- SMART COLLECTION RULES VALIDATION ---
    if (collectionType === "smart") {
      // Only allow rules with all fields non-empty
      const validRules = rules.filter(r => r.column && r.relation && (r.value || r.condition));
      if (!validRules.length) {
        showToast('You must add at least one complete rule to use Smart Collection.');
        return;
      }
      // Build rules in Shopify format
      const apiRules = validRules.map(({ column, relation, value, condition }) => ({
        column,
        relation,
        condition: value !== undefined ? value : condition
      }));
      // Log rules for debug
      console.log('[DEBUG] Rules going to mutation:', apiRules);
      formData.append("rules", JSON.stringify(apiRules));
      formData.append("globalCondition", globalCondition);
    }
    // Always send onlineStorePublicationId
    if (onlineStorePublicationId) {
      formData.append("onlineStorePublicationId", onlineStorePublicationId);
    }
    // For manual collections, send selectedProducts as productStatuses
    if (collectionType === "manual") {
      const allProductIds = Array.from(new Set([
        ...products.map(p => p.id),
        ...selectedProducts
      ]));
      const productStatuses = allProductIds.map(id => ({
        id,
        selected: selectedProducts.includes(id)
      }));
      formData.append("productStatuses", JSON.stringify(productStatuses));
    }
    submit(formData, { method: "post" });
    showToast('Collection successfully updated');
  };

  const handleSearchProducts = async () => {
    if (!searchQuery.trim()) return;
    
    setIsSearching(true);
    
    try {
      const response = await fetch(`/api/products/search?query=${encodeURIComponent(searchQuery)}`);
      const data = await response.json();
      setSearchResults(data.products || []);
    } catch (error) {
      console.error("Error searching products:", error);
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddRule = () => {
    setRules([
      ...rules,
      {
        column: "TITLE",
        relation: "EQUALS", 
        condition: "", // The actual value the user will enter
        value: ""    // UI value field that mirrors condition
      }
    ]);
  };

  const handleRemoveRule = (index) => {
    const newRules = [...rules];
    newRules.splice(index, 1);
    setRules(newRules);
  };

  const handleUpdateRule = (index, field, value) => {
    const newRules = [...rules];
    
    if (field === 'value') {
      // When updating the UI value field, also update condition for API
      newRules[index].value = value;
      newRules[index].condition = value; // Copy value to condition for API use
    } else {
      // For other fields (column, relation), update normally
      newRules[index][field] = value;
    }
    
    setRules(newRules);
  };

  const handleProductToggle = (productId) => {
    if (selectedProducts.includes(productId)) {
      setSelectedProducts(selectedProducts.filter(id => id !== productId));
      
      // Also update the checked products map
      setCheckedProducts(prev => ({
        ...prev,
        [productId]: false
      }));
    } else {
      setSelectedProducts([...selectedProducts, productId]);
      
      // Also update the checked products map
      setCheckedProducts(prev => ({
        ...prev,
        [productId]: true
      }));
    }
  };

  // Handle opening browse modal
  const handleOpenBrowseModal = async () => {
    setIsBrowseModalOpen(true);
    setIsLoadingAllProducts(true);
    
    try {
      // Fetch all products (or first batch)
      const response = await fetch('/api/products/search?query=');
      const data = await response.json();
      setAllProducts(data.products || []);
      
      // Initialize checked state based on currently selected products
      const initialChecked = {};
      data.products.forEach(product => {
        initialChecked[product.id] = selectedProducts.includes(product.id);
      });
      setCheckedProducts(prev => ({...prev, ...initialChecked}));
    } catch (error) {
      console.error("Error fetching products:", error);
    } finally {
      setIsLoadingAllProducts(false);
    }
  };

  // Handle checking a product in the browse modal
  const handleProductCheck = (productId) => {
    setCheckedProducts(prev => ({
      ...prev,
      [productId]: !prev[productId]
    }));
  };

  // Handle applying the selected products from the browse modal
  const handleApplySelectedProducts = () => {
    // Get all newly selected products that weren't already in the collection
    const currentlySelectedIds = selectedProducts;
    const selectedIds = Object.keys(checkedProducts).filter(id => checkedProducts[id]);
    
    // Find products to add (ones that are checked but not currently in the collection)
    const productsToAdd = selectedIds.filter(id => !currentlySelectedIds.includes(id));
    
    // Update UI state
    setSelectedProducts(selectedIds);
    setIsBrowseModalOpen(false);
    
    // Only make API call if there are products to add
    if (productsToAdd.length > 0) {
      // Create form data for adding the products
      const formData = new FormData();
      formData.append("action", "add_products");
      formData.append("productIds", JSON.stringify(productsToAdd));
      
      // Submit the form
      submit(formData, { method: "post" });
      
      // Show success message
      showToast(`${productsToAdd.length} products added to collection`);
    } else {
      showToast('No new products were selected');
    }
  };

  // Handle product removal (X icon click)
  const handleRemoveProduct = (productId) => {
    // Remove the product from selectedProducts
    const updatedSelectedProducts = selectedProducts.filter(id => id !== productId);
    setSelectedProducts(updatedSelectedProducts);
    
    // Also update the checked products map
    setCheckedProducts(prev => ({
      ...prev,
      [productId]: false
    }));
    
    // Update searchResults if applicable
    if (searchResults.length > 0) {
      const updatedSearchResults = searchResults.filter(product => product.id !== productId);
      setSearchResults(updatedSearchResults);
    }
    
    // Immediately save the collection with the product removed
    const formData = new FormData();
    formData.append("action", "remove_product");
    formData.append("productId", productId);
    
    submit(formData, { method: "post" });
    
    // Show success message
    showToast('Product removed from collection');
  };

  // Handle search in browse modal
  const handleBrowseSearch = async () => {
    if (!browseSearchQuery.trim()) {
      // If search is cleared, fetch all products again
      handleOpenBrowseModal();
      return;
    }
    
    setIsLoadingAllProducts(true);
    
    try {
      const response = await fetch(`/api/products/search?query=${encodeURIComponent(browseSearchQuery)}`);
      const data = await response.json();
      setAllProducts(data.products || []);
      
      // Make sure checked state is preserved
      const newCheckedState = {};
      data.products.forEach(product => {
        newCheckedState[product.id] = checkedProducts[product.id] || selectedProducts.includes(product.id);
      });
      setCheckedProducts(prev => ({...prev, ...newCheckedState}));
    } catch (error) {
      console.error("Error searching products:", error);
    } finally {
      setIsLoadingAllProducts(false);
    }
  };

  // Handle keyboard press in browse search input
  const handleBrowseKeyPress = (event) => {
    if (event.key === 'Enter') {
      handleBrowseSearch();
    }
  };

  const sortProducts = (products, sortOption) => {
    if (!products || products.length === 0) return [];
    
    const sortedProducts = [...products];
    
    switch (sortOption) {
      case "title_asc":
        return sortedProducts.sort((a, b) => a.title.localeCompare(b.title));
      case "title_desc":
        return sortedProducts.sort((a, b) => b.title.localeCompare(a.title));
      case "price_asc":
        return sortedProducts.sort((a, b) => {
          const aPrice = a.priceRangeV2?.minVariantPrice?.amount || 0;
          const bPrice = b.priceRangeV2?.minVariantPrice?.amount || 0;
          return parseFloat(aPrice) - parseFloat(bPrice);
        });
      case "price_desc":
        return sortedProducts.sort((a, b) => {
          const aPrice = a.priceRangeV2?.minVariantPrice?.amount || 0;
          const bPrice = b.priceRangeV2?.minVariantPrice?.amount || 0;
          return parseFloat(bPrice) - parseFloat(aPrice);
        });
      case "created_desc":
        return sortedProducts.sort((a, b) => {
          return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
        });
      case "best_selling":
      default:
        return sortedProducts; // Assume products are already sorted by best selling
    }
  };

  // Get count of selected products in browse modal
  const getSelectedProductsCount = () => {
    return Object.values(checkedProducts).filter(Boolean).length;
  };

  const handleSearchSubcategories = async () => {
    if (!subcatSearchQuery.trim()) return;
    
    setIsSearchingSubcats(true);
    
    try {
      const formData = new FormData();
      formData.append("action", "search_collections");
      formData.append("searchQuery", subcatSearchQuery);
      
      submit(formData, { method: "post" });
    } catch (error) {
      console.error("Error searching collections:", error);
      showToast("Error searching collections: " + error.message);
    } finally {
      setIsSearchingSubcats(false);
    }
  };

  // After handleSearchSubcategories function but before if (error) condition

  // Define handleOpenCreateSubcatModal 
  const handleOpenCreateSubcatModal = useCallback(() => {
    setIsCreateSubcatModalOpen(true);
    // Reset form fields
    setNewSubcatTitle("");
    setNewSubcatDescription("");
    setNewSubcatImageUrl("");
  }, []);
  
  // Auto-open modal if focusSubcategories parameter is present
  useEffect(() => {
    if (focusSubcategories) {
      // Automatically open the create subcategory modal after a short delay
      const timer = setTimeout(() => {
        handleOpenCreateSubcatModal();
      }, 500);
      
      return () => clearTimeout(timer);
    }
  }, [focusSubcategories, handleOpenCreateSubcatModal]);

  // In EditCollection, build parent options and ensure parent always appears
  const parentOptions = [
    { label: "None", value: "" },
    ...collections
      .filter(c => c.id !== `gid://shopify/Collection/${collectionId}`)
      .map(c => ({ label: c.title, value: c.id }))
  ];
  // If parentCollectionId is set and not in options, add it
  const parentInOptions = parentOptions.some(opt => opt.value === parentCollectionId);
  let finalParentOptions = parentOptions;
  if (parentCollectionId && !parentInOptions) {
    // Try to find the parent in all collections
    const parent = collections.find(c => c.id === parentCollectionId);
    finalParentOptions = [
      ...parentOptions,
      parent ? { label: parent.title, value: parent.id } : { label: `Unknown Parent (${parentCollectionId})`, value: parentCollectionId }
    ];
  }

  // Add effect to show backend errors as toast/banner
  useEffect(() => {
    if (actionData && actionData.success === false && actionData.message) {
      showToast(actionData.message);
    }
  }, [actionData]);

  useEffect(() => {
    if (actionData?.message) {
      setShowBanner(true);
    }
  }, [actionData?.message]);

  // Add a setter for isSmartCollection to keep it in sync with collectionType
  const [smartState, setSmartState] = useState(isSmartCollection);

  // Use collectionTypeShopify to determine if this is a true smart collection
  const [shopifyType, setShopifyType] = useState(collectionTypeShopify);

  // Add state for subcategory type and rules
  const [newSubcatType, setNewSubcatType] = useState("");
  const [newSubcatRules, setNewSubcatRules] = useState([{ column: "TITLE", relation: "EQUALS", condition: "", value: "" }]);
  const [newSubcatGlobalCondition, setNewSubcatGlobalCondition] = useState("AND");

  const handleAddNewSubcatRule = () => {
    setNewSubcatRules([...newSubcatRules, { column: "TITLE", relation: "EQUALS", condition: "", value: "" }]);
  };
  const handleRemoveNewSubcatRule = (index) => {
    setNewSubcatRules(newSubcatRules.filter((_, i) => i !== index));
  };
  const handleUpdateNewSubcatRule = (index, field, value) => {
    const newRules = [...newSubcatRules];
    newRules[index][field] = value;
    setNewSubcatRules(newRules);
  };

  if (error) {
    return (
      <Frame>
        <Page>
          <Banner status="critical">
            <p>{error}</p>
          </Banner>
          <Button url="/app/dashboard">Back to Collections</Button>
        </Page>
      </Frame>
    );
  }

  if (!collection) {
    return (
      <Frame>
        <Page>
          <EmptyState
            heading="Collection not found"
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>The collection you're looking for doesn't exist or you don't have permission to view it.</p>
            <Button url="/app/dashboard">Back to Collections</Button>
          </EmptyState>
        </Page>
      </Frame>
    );
  }

  return (
    <Frame>
      <Page>
        {activeToast && (
          <Toast content={toastMessage} onDismiss={toggleActiveToast} />
        )}

        <BlockStack gap="500">
          {/* Custom header row for back, title, and actions */}
          <div style={{ padding: '24px 0 0 0' }}>
            <InlineStack align="space-between" blockAlign="center" gap="400">
              <InlineStack gap="200" blockAlign="center">
                <Button
                  plain
                  icon={
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Icon source={CollectionIcon} tone="base" />
                    </span>
                  }
                  onClick={() => navigate(returnTo ? `${returnTo}?fromCollectionId=${collectionId}` : "/app/dashboard")}
                  accessibilityLabel="Back to Collections"
                />
                <Text variant="headingLg" as="h1">
                {collection.title}
                </Text>
              </InlineStack>
              <InlineStack gap="200" blockAlign="center">
                <Button url={returnTo ? `${returnTo}?fromCollectionId=${collectionId}` : "/app/dashboard"}>
                  Cancel
                </Button>
                <Button
                  primary
                  onClick={handleUpdateCollection}
                  loading={isLoading}
                  disabled={isImageProcessing || !title}
                >
                  Save
                </Button>
              </InlineStack>
            </InlineStack>
          </div>
          {/* Confirmation banner directly below header row */}
          {actionData?.message && showBanner && (
            <div style={{ margin: '0px 0' }}>
              <Banner
                title={actionData.message}
                status={actionData.success ? "success" : "critical"}
                onDismiss={() => setShowBanner(false)}
              />
            </div>
          )}

          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">
                    Collection Details
                  </Text>
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
                  <CollectionImageUpload
                    onImageUpload={setImageUrl}
                    initialImageUrl={imageUrl}
                    onProcessingChange={setIsImageProcessing}
                  />
                  <Select
                    label="Parent Collection"
                    options={finalParentOptions}
                    value={parentCollectionId}
                    onChange={setParentCollectionId}
                    helpText="Select a parent collection if this is a subcategory"
                  />
                  <BlockStack gap="200">
                    <Text>Product Assignment Type</Text>
                    <Banner status="info">
                      This collection type is fixed and cannot be changed after creation.
                    </Banner>
                    <RadioButton
                      label="Manual"
                      checked={collectionType === "manual"}
                      id="manual"
                      name="collectionType"
                      onChange={() => {}}
                      disabled={true}
                    />
                    <RadioButton
                      label="Smart (Automated)"
                      checked={collectionType === "smart"}
                      id="smart"
                      name="collectionType"
                      onChange={() => {}}
                      disabled={true}
                    />
                  </BlockStack>
                </BlockStack>
              </Card>
            </Layout.Section>

            {/* Search Products Section (always shown) */}
            {collectionType === "manual" && (
              <Layout.Section>
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd" as="h2">
                      Search Products
                    </Text>
                    <InlineStack gap="200" align="start">
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', width: '100%' }}>
                        <div style={{ flexGrow: 1 }}>
                          <TextField
                            label="Search products"
                            value={searchQuery}
                            onChange={(value) => {
                              setSearchQuery(value);
                              if (value.trim().length > 2) {
                                setIsSearching(true);
                                fetch(`/api/products/search?query=${encodeURIComponent(value)}`)
                                  .then(response => response.json())
                                  .then(data => {
                                    setSearchResults(data.products || []);
                                    setIsSearching(false);
                                  })
                                  .catch(error => {
                                    console.error("Error searching products:", error);
                                    setIsSearching(false);
                                  });
                              } else {
                                setSearchResults([]);
                              }
                            }}
                            autoComplete="off"
                            prefix={<Icon source={SearchIcon} />}
                            placeholder="Search products"
                          />
                        </div>
                        <div>
                          <Button variant="plain" onClick={handleOpenBrowseModal}>Browse</Button>
                        </div>
                        <div>
                          <Select
                            label="Sort"
                            labelHidden
                            options={[
                              { label: "Best selling", value: "best_selling" },
                              { label: "Title: A-Z", value: "title_asc" },
                              { label: "Title: Z-A", value: "title_desc" },
                              { label: "Price: Low to high", value: "price_asc" },
                              { label: "Price: High to low", value: "price_desc" },
                              { label: "Newest", value: "created_desc" }
                            ]}
                            value={sortOption}
                            onChange={(value) => setSortOption(value)}
                          />
                        </div>
                      </div>
                    </InlineStack>
                    {isSearching ? (
                      <BlockStack gap="400" alignment="center">
                        <Spinner accessibilityLabel="Loading products" size="large" />
                      </BlockStack>
                    ) : (
                      <div>
                        {sortProducts(searchResults.length > 0 ? searchResults : products.filter(p => selectedProducts.includes(p.id)), sortOption).map((product, index) => (
                          <div key={product.id} style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'space-between',
                            padding: '12px 0',
                            borderBottom: index !== (searchResults.length > 0 ? searchResults.length - 1 : products.length - 1) ? '1px solid #E1E3E5' : 'none'
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                              <Text variant="bodyMd">{index + 1}.</Text>
                              <Thumbnail
                                source={product.featuredImage?.url || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-collection-1.png"}
                                alt={product.featuredImage?.altText || product.title}
                                size="small"
                              />
                              <Text variant="bodyMd">{product.title}</Text>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <Badge tone="success">Active</Badge>
                              <Button
                                icon={XIcon}
                                onClick={() => handleRemoveProduct(product.id)}
                                variant="plain"
                                accessibilityLabel="Remove product"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {pageInfo?.hasNextPage && (
                      <InlineStack align="center">
                        <Pagination
                          hasPrevious={currentPage > 1}
                          hasNext={pageInfo.hasNextPage}
                          onPrevious={() => setCurrentPage(currentPage - 1)}
                          onNext={() => setCurrentPage(currentPage + 1)}
                        />
                      </InlineStack>
                    )}
                  </BlockStack>
                </Card>
              </Layout.Section>
            )}

            {/* Smart Collection Rules Section (if smart) */}
            {collectionType === "smart" && (
              <Layout.Section>
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd" as="h2">
                      Smart Collection Rules
                    </Text>
                    <Text variant="bodyMd" as="p">
                      Products that match these rules will be automatically added to this collection.
                    </Text>
                    <FormLayout>
                      <FormLayout.Group>
                        <RadioButton
                          label="Products must match all conditions"
                          checked={globalCondition === 'AND'}
                          id="all_conditions"
                          name="globalCondition"
                          onChange={() => setGlobalCondition('AND')}
                          disabled={shopifyType !== 'SMART'}
                        />
                        <RadioButton
                          label="Products can match any condition"
                          checked={globalCondition === 'OR'}
                          id="any_condition"
                          name="globalCondition"
                          onChange={() => setGlobalCondition('OR')}
                          disabled={shopifyType !== 'SMART'}
                        />
                      </FormLayout.Group>
                      <Text variant="bodySm" tone="subdued">
                        {shopifyType !== 'SMART'
                          ? 'This is a custom collection. Convert to smart to use rules.'
                          : currentSettingText}
                      </Text>
                      {rules.map((rule, index) => (
                        <FormLayout.Group key={index} condensed>
                          <Card>
                            <BlockStack gap="200">
                              <InlineStack align="space-between">
                                <Text variant="headingSm" as="h3">
                                  Rule {index + 1}
                                </Text>
                                <Button
                                  icon={MinusIcon}
                                  onClick={() => handleRemoveRule(index)}
                                  accessibilityLabel="Remove rule"
                                  disabled={shopifyType !== 'SMART'}
                                />
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
                                    onChange={(value) => handleUpdateRule(index, "column", value)}
                                    disabled={shopifyType !== 'SMART'}
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
                                    onChange={(value) => handleUpdateRule(index, "relation", value)}
                                    disabled={shopifyType !== 'SMART'}
                                  />
                                  <TextField
                                    label="Value"
                                    value={rule.value || ""}
                                    onChange={(value) => handleUpdateRule(index, "value", value)}
                                    autoComplete="off"
                                    disabled={shopifyType !== 'SMART'}
                                  />
                                </FormLayout.Group>
                              </FormLayout>
                            </BlockStack>
                          </Card>
                        </FormLayout.Group>
                      ))}
                      <Button icon={PlusIcon} onClick={handleAddRule} disabled={shopifyType !== 'SMART'}>
                        Add Rule
                      </Button>
                    </FormLayout>
                  </BlockStack>
                </Card>
              </Layout.Section>
            )}

            {/* Filtered Products (Smart Rule Matches) Section (if smart) */}
            {collectionType === "smart" && (
              <Layout.Section>
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd" as="h2">
                      Products Matching Rules
                    </Text>
                    <Text variant="bodyMd" as="p">
                      These products automatically match your collection rules.
                    </Text>
                    {isPreviewLoading ? (
                      <BlockStack gap="400" alignment="center">
                        <Spinner accessibilityLabel="Loading products" size="large" />
                        <Text variant="bodyMd">Loading products that match your rules...</Text>
                      </BlockStack>
                    ) : previewProducts.length > 0 ? (
                      <ResourceList
                        items={previewProducts}
                        renderItem={(product) => {
                          const { id, title, featuredImage } = product;
                          const media = (
                            <Thumbnail
                              source={featuredImage?.url || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-collection-1.png"}
                              alt={featuredImage?.altText || title}
                            />
                          );
                          return (
                            <ResourceList.Item
                              id={id}
                              media={media}
                              accessibilityLabel={`Product: ${title}`}
                            >
                              <Text variant="bodyMd" fontWeight="bold">{title}</Text>
                            </ResourceList.Item>
                          );
                        }}
                      />
                    ) : (
                      <EmptyState
                        heading="No products match these rules"
                        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                      >
                        <p>Try adjusting your collection rules to match products in your store.</p>
                      </EmptyState>
                    )}
                    {pageInfo?.hasNextPage && (
                      <InlineStack align="center">
                        <Pagination
                          hasPrevious={currentPage > 1}
                          hasNext={pageInfo.hasNextPage}
                          onPrevious={() => setCurrentPage(currentPage - 1)}
                          onNext={() => setCurrentPage(currentPage + 1)}
                        />
                      </InlineStack>
                    )}
                  </BlockStack>
                </Card>
              </Layout.Section>
            )}

            {/* Subcategories Management Section */}
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">
                    Subcategories
                  </Text>
                  <Text variant="bodyMd" as="p">
                    Manage subcategories for this collection.
                  </Text>
                  <InlineStack gap="300" align="start">
                    <Button onClick={handleOpenSubcatModal}>Add Existing Collections</Button>
                    <Button onClick={handleOpenCreateSubcatModal}>Create Subcategory</Button>
                  </InlineStack>
                  {subcategoriesList.length > 0 ? (
                    <ResourceList
                      items={subcategoriesList.filter((subcategory, index, self) => 
                        index === self.findIndex(s => s.id === subcategory.id)
                      )}
                      renderItem={(subcategory) => {
                        const { id, title, image } = subcategory;
                        const media = (
                          <Thumbnail
                            source={image?.url || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-collection-1.png"}
                            alt={title}
                          />
                        );
                        return (
                          <ResourceList.Item
                            id={id}
                            media={media}
                            accessibilityLabel={`Collection: ${title}`}
                            shortcutActions={[
                              {
                                content: 'Remove',
                                icon: XIcon,
                                accessibilityLabel: `Remove ${title}`,
                                onClick: () => handleRemoveSubcategory(id)
                              }
                            ]}
                            url={`/app/collections/edit/${id.replace('gid://shopify/Collection/', '')}`}
                          >
                            <Text variant="bodyMd" fontWeight="bold">{title}</Text>
                          </ResourceList.Item>
                        );
                      }}
                    />
                  ) : (
                    <EmptyState
                      heading="No subcategories yet"
                      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                    >
                      <p>Add existing collections or create new subcategories for this collection.</p>
                    </EmptyState>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
          
          {/* Subcategories Selection Modal */}
          <Modal
            open={isSubcatModalOpen}
            onClose={() => setIsSubcatModalOpen(false)}
            title="Add Subcategories"
            primaryAction={{
              content: "Add Selected",
              onAction: handleApplySelectedSubcats
            }}
            secondaryActions={[
              {
                content: "Cancel",
                onAction: () => setIsSubcatModalOpen(false)
              }
            ]}
          >
            <Modal.Section>
              <BlockStack gap="400">
                <InlineStack gap="200" align="start" blockAlign="center">
                  <div style={{ flexGrow: 1 }}>
                    <TextField
                      label="Filter collections"
                      value={subcatSearchQuery}
                      onChange={(value) => {
                        setSubcatSearchQuery(value);
                        // Filter collections client-side as user types
                        if (value.trim() === "") {
                          // If search is cleared, show all collections again
                          handleOpenSubcatModal();
                        } else {
                          // Filter the collections that were already loaded
                          const filtered = subcatSearchResults.filter(
                            collection => collection.title.toLowerCase().includes(value.toLowerCase())
                          );
                          setSubcatSearchResults(filtered);
                        }
                      }}
                      autoComplete="off"
                      placeholder="Filter collections"
                    />
                  </div>
                </InlineStack>
                
                {isSearchingSubcats ? (
                  <div style={{ textAlign: "center", padding: "2rem" }}>
                    <Spinner size="large" />
                  </div>
                ) : subcatSearchResults.length === 0 ? (
                  <EmptyState
                    heading="No collections found"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>No collections match your filter criteria.</p>
                  </EmptyState>
                ) : (
                  <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
                    {subcatSearchResults.map((collection) => (
                      <div key={collection.id} style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        padding: '12px 0',
                        borderBottom: '1px solid #E1E3E5'
                      }}>
                        <div style={{ marginRight: '12px' }}>
                          <Checkbox
                            label=""
                            labelHidden
                            checked={selectedSubcats[collection.id] || false}
                            onChange={() => handleSubcatCheck(collection.id)}
                          />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexGrow: 1 }}>
                          <Thumbnail
                            source={collection.image?.url || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-collection-1.png"}
                            alt={collection.title}
                            size="small"
                          />
                          <div>
                            <Text variant="bodyMd" fontWeight="bold">{collection.title}</Text>
                            <Text variant="bodySm" tone="subdued">/{collection.handle}</Text>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                <div style={{ padding: '12px 0', borderTop: '1px solid #E1E3E5', marginTop: '8px' }}>
                  <Text variant="bodySm">
                    {Object.values(selectedSubcats).filter(Boolean).length} collections selected
                  </Text>
                </div>
              </BlockStack>
            </Modal.Section>
          </Modal>
          
          {/* Create Subcategory Modal */}
          <Modal
            open={isCreateSubcatModalOpen}
            onClose={() => setIsCreateSubcatModalOpen(false)}
            title="Create Subcategory"
            primaryAction={{
              content: "Create",
              onAction: handleCreateSubcategory,
              loading: isCreatingSubcat,
              disabled: isCreatingSubcat || !newSubcatTitle || !newSubcatType || (newSubcatType === "smart" && newSubcatRules.filter(r => r.column && r.relation && (r.value || r.condition)).length === 0)
            }}
            secondaryActions={[
              {
                content: "Cancel",
                onAction: () => setIsCreateSubcatModalOpen(false)
              }
            ]}
          >
            <Modal.Section>
              <BlockStack gap="400">
                <TextField
                  label="Title"
                  value={newSubcatTitle}
                  onChange={setNewSubcatTitle}
                  autoComplete="off"
                  requiredIndicator
                />
                <TextField
                  label="Description"
                  value={newSubcatDescription}
                  onChange={setNewSubcatDescription}
                  autoComplete="off"
                  multiline={4}
                />
                <BlockStack gap="200">
                  <Text variant="headingSm">Collection Type <span style={{ color: 'red' }}>*</span></Text>
                  <RadioButton
                    label="Manual (Custom) Collection"
                    checked={newSubcatType === "manual"}
                    id="subcat-manual"
                    name="subcatType"
                    onChange={() => setNewSubcatType("manual")}
                    disabled={false}
                  />
                  <RadioButton
                    label="Smart (Automated) Collection"
                    checked={newSubcatType === "smart"}
                    id="subcat-smart"
                    name="subcatType"
                    onChange={() => setNewSubcatType("smart")}
                    disabled={false}
                  />
                </BlockStack>
                {newSubcatType === "smart" && (
                  <BlockStack gap="400">
                    <Text variant="headingMd">Smart Collection Rules</Text>
                    <Text variant="bodySm" tone="subdued">Products that match these rules will be automatically added to this subcategory.</Text>
                    <FormLayout>
                      <FormLayout.Group>
                        <RadioButton
                          label="Products must match all conditions"
                          checked={newSubcatGlobalCondition === 'AND'}
                          id="subcat_all_conditions"
                          name="subcatGlobalCondition"
                          onChange={() => setNewSubcatGlobalCondition('AND')}
                          disabled={false}
                        />
                        <RadioButton
                          label="Products can match any condition"
                          checked={newSubcatGlobalCondition === 'OR'}
                          id="subcat_any_condition"
                          name="subcatGlobalCondition"
                          onChange={() => setNewSubcatGlobalCondition('OR')}
                          disabled={false}
                        />
                      </FormLayout.Group>
                      {newSubcatRules.map((rule, index) => (
                        <FormLayout.Group key={index} condensed>
                          <Card>
                            <BlockStack gap="200">
                              <InlineStack align="space-between">
                                <Text variant="headingSm" as="h3">Rule {index + 1}</Text>
                                <Button
                                  icon={PlusIcon}
                                  onClick={handleAddNewSubcatRule}
                                  accessibilityLabel="Add rule"
                                  disabled={false}
                                >
                                  Add Rule
                                </Button>
                                {newSubcatRules.length > 1 && (
                                  <Button
                                    icon={MinusIcon}
                                    onClick={() => handleRemoveNewSubcatRule(index)}
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
                                    onChange={(value) => handleUpdateNewSubcatRule(index, "column", value)}
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
                                    onChange={(value) => handleUpdateNewSubcatRule(index, "relation", value)}
                                    disabled={false}
                                  />
                                  <TextField
                                    label="Value"
                                    value={rule.value || ""}
                                    onChange={(value) => handleUpdateNewSubcatRule(index, "value", value)}
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
                  onImageUpload={setNewSubcatImageUrl}
                  initialImageUrl={newSubcatImageUrl}
                  onProcessingChange={setIsImageProcessing}
                />
              </BlockStack>
            </Modal.Section>
          </Modal>
          
          {/* Browse Products Modal */}
          <Modal
            open={isBrowseModalOpen}
            onClose={() => setIsBrowseModalOpen(false)}
            title="Browse Products"
            primaryAction={{
              content: `Done (${getSelectedProductsCount()} selected)`,
              onAction: handleApplySelectedProducts
            }}
            secondaryActions={[
              {
                content: "Cancel",
                onAction: () => setIsBrowseModalOpen(false)
              }
            ]}
            large
          >
            <Modal.Section>
              <BlockStack gap="400">
                <InlineStack gap="200" align="start" blockAlign="center">
                  <div style={{ flexGrow: 1 }}>
                    <TextField
                      label="Search products"
                      value={browseSearchQuery}
                      onChange={setBrowseSearchQuery}
                      autoComplete="off"
                      placeholder="Search products"
                      labelHidden
                      onKeyPress={handleBrowseKeyPress}
                    />
                  </div>
                  <Button onClick={handleBrowseSearch}>
                    Search
                  </Button>
                </InlineStack>
                
                {isLoadingAllProducts ? (
                  <div style={{ textAlign: "center", padding: "2rem" }}>
                    <Spinner size="large" />
                  </div>
                ) : allProducts.length === 0 ? (
                  <EmptyState
                    heading="No products found"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>Try changing your search criteria.</p>
                  </EmptyState>
                ) : (
                  <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
                    {allProducts.map((product) => (
                      <div key={product.id} style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        padding: '12px 0',
                        borderBottom: '1px solid #E1E3E5'
                      }}>
                        <div style={{ marginRight: '12px' }}>
                          <Checkbox
                            label=""
                            labelHidden
                            checked={checkedProducts[product.id] || false}
                            onChange={() => handleProductCheck(product.id)}
                          />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexGrow: 1 }}>
                          <Thumbnail
                            source={product.featuredImage?.url || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-collection-1.png"}
                            alt={product.featuredImage?.altText || product.title}
                            size="small"
                          />
                          <div>
                            <Text variant="bodyMd" fontWeight="bold">{product.title}</Text>
                            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                              {product.status === "ACTIVE" && <Badge tone="success">Active</Badge>}
                              {product.vendor && <Text variant="bodySm" color="subdued">{product.vendor}</Text>}
                              {product.productType && <Text variant="bodySm" color="subdued">{product.productType}</Text>}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                <div style={{ padding: '12px 0', borderTop: '1px solid #E1E3E5', marginTop: '8px' }}>
                  <Text variant="bodySm">
                    {getSelectedProductsCount()} products selected
                  </Text>
                </div>
              </BlockStack>
            </Modal.Section>
          </Modal>
        </BlockStack>
      </Page>
    </Frame>
  );
} 