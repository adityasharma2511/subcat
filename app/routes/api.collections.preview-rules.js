import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  
  try {
    const { rules, collectionId, globalCondition } = await request.json();
    
    // Make sure we have valid rules
    if (!rules || !Array.isArray(rules) || rules.length === 0) {
      return json({
        products: [],
        error: "No valid rules provided"
      });
    }
    
    // Filter out invalid rules
    const validRules = rules.filter(rule => 
      rule.column && 
      rule.relation && 
      rule.condition !== undefined && 
      rule.condition !== null
    );
    
    if (validRules.length === 0) {
      return json({
        products: [],
        error: "No valid rules provided after filtering"
      });
    }
    
    // Query for products that match the rules
    const response = await admin.graphql(
      `#graphql
      query GetProducts($first: Int!) {
        products(first: $first) {
          edges {
            node {
              id
              title
              handle
              featuredImage {
                url
                altText
              }
              vendor
              productType
              tags
              priceRangeV2 {
                minVariantPrice {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }`,
      {
        variables: {
          first: 50 // Fetch more products to filter client-side
        }
      }
    );
    
    const responseJson = await response.json();
    
    if (!responseJson.data || !responseJson.data.products) {
      return json({
        products: [],
        error: "Failed to get products"
      });
    }
    
    // Extract products from the response
    const products = responseJson.data.products.edges.map(edge => edge.node);
    
    // Filter products manually based on rules
    // This is a simplified version as Shopify API doesn't directly support preview
    const filteredProducts = filterProductsByRules(products, validRules, globalCondition);
    
    return json({
      products: filteredProducts,
      success: true
    });
    
  } catch (error) {
    console.error("Error previewing products by rules:", error);
    return json({
      products: [],
      error: error.message || "An error occurred"
    }, { status: 500 });
  }
}

// Simple client-side rule filtering (approximation)
function filterProductsByRules(products, rules, globalCondition = 'AND') {
  if (!products.length || !rules.length) return [];
  
  console.log(`Filtering with ${globalCondition} logic (disjunctive: ${globalCondition === 'OR'})`);
  
  return products.filter(product => {
    if (globalCondition === 'OR') {
      // OR logic (disjunctive: true) - any rule must match
      return rules.some(rule => {
        const { column, relation, condition } = rule;
        
        // Get the value to compare from the product
        let value = '';
        switch (column) {
          case 'TITLE':
            value = product.title || '';
            break;
          case 'TYPE':
            value = product.productType || '';
            break;
          case 'VENDOR':
            value = product.vendor || '';
            break;
          case 'PRICE':
            value = product.priceRangeV2?.minVariantPrice?.amount || '0';
            break;
          case 'TAG':
            return matchTag(product.tags || [], relation, condition);
          default:
            return false;
        }
        
        // Compare based on relation
        return compareValues(value, relation, condition);
      });
    } else {
      // AND logic (disjunctive: false) - all rules must match
      return rules.every(rule => {
        const { column, relation, condition } = rule;
        
        // Get the value to compare from the product
        let value = '';
        switch (column) {
          case 'TITLE':
            value = product.title || '';
            break;
          case 'TYPE':
            value = product.productType || '';
            break;
          case 'VENDOR':
            value = product.vendor || '';
            break;
          case 'PRICE':
            value = product.priceRangeV2?.minVariantPrice?.amount || '0';
            break;
          case 'TAG':
            return matchTag(product.tags || [], relation, condition);
          default:
            return false;
        }
        
        // Compare based on relation
        return compareValues(value, relation, condition);
      });
    }
  });
}

function matchTag(tags, relation, condition) {
  if (!tags || !tags.length) return false;
  
  switch (relation) {
    case 'EQUALS':
      return tags.includes(condition);
    case 'NOT_EQUALS':
      return !tags.includes(condition);
    case 'CONTAINS':
      return tags.some(tag => tag.includes(condition));
    case 'NOT_CONTAINS':
      return !tags.some(tag => tag.includes(condition));
    default:
      return false;
  }
}

function compareValues(value, relation, condition) {
  if (value === undefined || value === null) return false;
  
  // Convert to string for consistency
  const strValue = String(value).toLowerCase();
  const strCondition = String(condition).toLowerCase();
  
  switch (relation) {
    case 'EQUALS':
      return strValue === strCondition;
    case 'NOT_EQUALS':
      return strValue !== strCondition;
    case 'GREATER_THAN':
      return parseFloat(strValue) > parseFloat(strCondition);
    case 'LESS_THAN':
      return parseFloat(strValue) < parseFloat(strCondition);
    case 'STARTS_WITH':
      return strValue.startsWith(strCondition);
    case 'ENDS_WITH':
      return strValue.endsWith(strCondition);
    case 'CONTAINS':
      return strValue.includes(strCondition);
    case 'NOT_CONTAINS':
      return !strValue.includes(strCondition);
    default:
      return false;
  }
} 