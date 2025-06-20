import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";



export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action");

  if (action === "stage") {
    // Step 1: Get staged upload URL
    const filename = formData.get("filename");
    const fileSize = formData.get("fileSize");
    const mimeType = formData.get("mimeType");

    if (!filename || !fileSize || !mimeType) {
      return json({ error: "Missing required file information" }, { status: 400 });
    }

    try {
      const response = await admin.graphql(
        `#graphql
        mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
          stagedUploadsCreate(input: $input) {
            stagedTargets {
              resourceUrl
              url
              parameters {
                name
                value
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
            input: [{
              filename,
              fileSize,
              httpMethod: "POST",
              mimeType,
              resource: "IMAGE"
            }]
          }
        }
      );

      const data = await response.json();
      
      if (data.data?.stagedUploadsCreate?.userErrors?.length > 0) {
        return json({ error: data.data.stagedUploadsCreate.userErrors[0].message }, { status: 400 });
      }

      return json(data.data.stagedUploadsCreate.stagedTargets[0]);
    } catch (error) {
      console.error('Stage upload error:', error);
      return json({ error: "Failed to create staged upload" }, { status: 500 });
    }
  } else if (action === "create") {
    // Step 3: Create file in Shopify
    const resourceUrl = formData.get("resourceUrl");

    if (!resourceUrl) {
      return json({ error: "Missing resource URL" }, { status: 400 });
    }

    try {
      const response = await admin.graphql(
        `#graphql
        mutation fileCreate($files: [FileCreateInput!]!) {
          fileCreate(files: $files) {
            files {
              ... on File {
                id
                createdAt
                alt
                fileStatus
                preview {
                  image {
                    url
                  }
                }
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
            files: [{
              alt: "Collection image",
              contentType: "IMAGE",
              originalSource: resourceUrl
            }]
          }
        }
      );

      const data = await response.json();
      
      if (data.data?.fileCreate?.userErrors?.length > 0) {
        return json({ error: data.data.fileCreate.userErrors[0].message }, { status: 400 });
      }

      if (!data.data?.fileCreate?.files?.[0]) {
        return json({ error: "No file was created" }, { status: 400 });
      }

      const file = data.data.fileCreate.files[0];
      if (!file.preview?.image?.url) {
        return json({ 
          fileId: file.id,
          status: file.fileStatus
        }, { status: 202 });
      }

      const imageUrl = file.preview.image.url;
      return json({ imageUrl });
    } catch (error) {
      console.error('File create error:', error);
      return json({ error: "Failed to create file" }, { status: 500 });
    }
  }

  return json({ error: "Invalid action" }, { status: 400 });
}

export async function loader({ request }) {
  const url = new URL(request.url);
  const fileId = url.searchParams.get('fileId');
  if (!fileId) {
    return json({ error: 'Missing fileId' }, { status: 400 });
  }
  try {
    const { admin } = await authenticate.admin(request);
    let hasNextPage = true;
    let after = null;
    let foundFile = null;
    while (hasNextPage && !foundFile) {
      const response = await admin.graphql(
        `#graphql
        query getFile($id: String!, $after: String) {
          files(first: 50, query: $id, after: $after) {
            edges {
              node {
                ... on MediaImage {
                  id
                  preview {
                    image {
                      url
                    }
                  }
                }
              }
              cursor
            }
            pageInfo {
              hasNextPage
            }
          }
        }`,
        { variables: { id: fileId, after } }
      );
      const data = await response.json();
      const edges = data.data?.files?.edges || [];
      foundFile = edges.map(e => e.node).find(n => n.id === fileId);
      hasNextPage = data.data?.files?.pageInfo?.hasNextPage;
      if (edges.length > 0 && hasNextPage) {
        after = edges[edges.length - 1].cursor;
      } else {
        after = null;
      }
    }
    if (!foundFile) {
      return json({ status: 'processing' }, { status: 202 });
    }
    const imageUrl = foundFile.preview?.image?.url;
    if (!imageUrl) {
      return json({ status: 'processing' }, { status: 202 });
    }
    return json({ imageUrl });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
} 