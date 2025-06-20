import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  try {
    const formData = await request.formData();
    const resourceUrl = JSON.parse(formData.get("variables"));

    const query = `#graphql
      mutation fileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files {
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
          userErrors {
            field
            message
          }
        }
      }`;

    const response = await admin.graphql(query, {
      variables: {
        files: [
          {
            alt: "Collection Image",
            contentType: "IMAGE",
            originalSource: resourceUrl
          }
        ]
      }
    });

    const responseJson = await response.json();

    if (responseJson.data?.fileCreate?.userErrors?.length > 0) {
      return json({
        success: false,
        errors: responseJson.data.fileCreate.userErrors,
      });
    }

    return json({
      success: true,
      body: responseJson,
    });
  } catch (error) {
    return json({
      success: false,
      error: error.message,
    });
  }
}; 