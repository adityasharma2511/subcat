import { authenticate } from "../shopify.server";

// export const loader = async ({ request }) => {
//   await authenticate.admin(request);

//   return null;
// };

export const loader = async ({ request }) => {
  // Force online session
  return authenticate.admin(request, {
    accessMode: 'online',
  });
};
