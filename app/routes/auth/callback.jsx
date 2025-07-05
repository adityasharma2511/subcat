import { authenticate } from "~/shopify.server";

export const loader = async ({ request }) => {
  return authenticate.callback(request);
}; 