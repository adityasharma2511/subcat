import * as Polaris from '@shopify/polaris';
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useSubmit } from "@remix-run/react";
import { useState, useEffect } from "react";
import { MobileIcon, DesktopIcon } from '@shopify/polaris-icons';
import { authenticate } from "../shopify.server";

// --- Loader: fetch current settings and plan ---
export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  // Fetch current settings from metafield (or your app's config storage)
  const metafieldRes = await admin.graphql(`
    query {
      shop {
        metafield(namespace: "custom", key: "widget_settings") {
          value
        }
      }
    }
  `);
  const metafieldJson = await metafieldRes.json();
  const metafield = metafieldJson.data?.shop?.metafield;
  const settings = metafield?.value ? JSON.parse(metafield.value) : {};
  console.log('[DEBUG] Loaded settings from metafield:', settings);

  // Fetch user plan (replace with your own logic)
  const plan = session?.plan || "free"; // e.g., "free", "paid"

  return json({ settings, plan });
};

// --- Action: save settings to metafield ---
export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  let settings = JSON.parse(formData.get("settings"));

  // Ensure correct types for custom_border_radius_enabled and custom_border_radius
  settings.custom_border_radius_enabled = Boolean(settings.custom_border_radius_enabled);
  if (settings.custom_border_radius !== '' && settings.custom_border_radius !== undefined && settings.custom_border_radius !== null) {
    settings.custom_border_radius = Number(settings.custom_border_radius);
  } else {
    settings.custom_border_radius = '';
  }
  console.log('[DEBUG] Settings to save:', settings);

  // Fetch shop GID
  const shopRes = await admin.graphql(`query { shop { id } }`);
  const shopJson = await shopRes.json();
  const shopId = shopJson?.data?.shop?.id;
  console.log("[DEBUG] shopId:", shopId);
  if (!shopId) {
    return json({ success: false, error: "Could not fetch shop ID." }, { status: 500 });
  }

  // Set metafield
  const metafieldsInput = [{
    namespace: "custom",
    key: "widget_settings",
    type: "json",
    value: JSON.stringify(settings),
    ownerId: shopId
  }];
  console.log("[DEBUG] metafieldsInput:", JSON.stringify(metafieldsInput, null, 2));

  const result = await admin.graphql(`
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id key value }
        userErrors { field message }
      }
    }
  `, { variables: { metafields: metafieldsInput } });

  const resultJson = await result.json();
  console.log("[DEBUG] metafieldsSet resultJson:", JSON.stringify(resultJson, null, 2));

  const userErrors = resultJson?.data?.metafieldsSet?.userErrors;
  if (userErrors && userErrors.length > 0) {
    return json({ success: false, error: userErrors.map(e => e.message).join(", ") }, { status: 400 });
  }

  return json({ success: true });
};

const {
  Page, Card, Text, Select, RadioButton, TextField, Button, BlockStack, InlineStack, Banner, Frame, Checkbox, Icon, Box, ButtonGroup
} = Polaris;

const LAYOUT_OPTIONS = [
  { label: "Circle", value: "circle" },
  { label: "Square", value: "square" }
];
const TEXT_SIZE_OPTIONS = [
  { label: "Small", value: "small" },
  { label: "Medium", value: "medium" },
  { label: "Large", value: "large" }
];
const ALIGNMENT_OPTIONS = [
  { label: "Left", value: "left" },
  { label: "Center", value: "center" },
  { label: "Right", value: "right" }
];

export default function WidgetPage() {
  const { settings: initialSettings, plan } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();

  // Banner dismiss state
  const [showBanner, setShowBanner] = useState(false);
  useEffect(() => {
    if (actionData?.success) setShowBanner(true);
  }, [actionData]);

  // --- State for settings ---
  const [settings, setSettings] = useState({
    layout: initialSettings.layout || "circle",
    text_size: initialSettings.text_size || 16,
    alignment: initialSettings.alignment || "center",
    heading_text: initialSettings.heading_text || "Subcategories",
    show_heading: initialSettings.show_heading !== false,
    scroll_enabled: initialSettings.scroll_enabled || false,
    custom_border_radius_enabled: initialSettings.custom_border_radius_enabled || false,
    custom_border_radius: initialSettings.custom_border_radius !== undefined && initialSettings.custom_border_radius !== '' && initialSettings.custom_border_radius !== null ? Number(initialSettings.custom_border_radius) : '',
    show_product_count: initialSettings.show_product_count || false,
    section_padding: initialSettings.section_padding || 16,
    bubble_bg_color: initialSettings.bubble_bg_color || '#D6EDFF',
    bubble_text_color: initialSettings.bubble_text_color || '#19536B',
    text_transform: initialSettings.text_transform || 'none',
    bold_titles: initialSettings.bold_titles || false,
    image_size: initialSettings.image_size || 'medium',
    show_title: initialSettings.show_title !== false,
    show_image: initialSettings.show_image !== false,
  });
  const [previewMode, setPreviewMode] = useState("desktop");

  // --- Plan logic ---
  const layoutOptions = [
    { label: "Circle", value: "circle" },
    { label: "Square", value: "square" }
  ];
  const textSizeOptions = [
    { label: "Small", value: "small" },
    { label: "Medium", value: "medium" },
    { label: "Large", value: "large" }
  ];
  const alignmentOptions = [
    { label: "Left", value: "left" },
    { label: "Center", value: "center" },
    { label: "Right", value: "right" }
  ];

  // --- Handle setting changes ---
  const handleChange = (key, value) => {
    // Always coerce custom_border_radius to number if not blank
    if (key === 'custom_border_radius') {
      setSettings(prev => ({ ...prev, [key]: value !== '' && value !== undefined && value !== null ? Number(value) : '' }));
    } else {
      setSettings(prev => ({ ...prev, [key]: value }));
    }
  };

  // --- Save settings ---
  const handleSave = () => {
    const formData = new FormData();
    // Always coerce custom_border_radius to number if not blank
    const saveSettings = { ...settings };
    if (saveSettings.custom_border_radius !== '' && saveSettings.custom_border_radius !== undefined && saveSettings.custom_border_radius !== null) {
      saveSettings.custom_border_radius = Number(saveSettings.custom_border_radius);
    } else {
      saveSettings.custom_border_radius = '';
    }
    formData.append("settings", JSON.stringify(saveSettings));
    submit(formData, { method: "post" });
  };

  // --- Live Preview (dummy data) ---
  const dummySubcats = [
    { title: "Shoes", image: "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-collection-1.png", products_count: 1 },
    { title: "Hats", image: "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-collection-1.png", products_count: 5 },
    { title: "Bags", image: "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-collection-1.png", products_count: 12 },
    { title: "Accessories", image: "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-collection-1.png", products_count: 0 }
  ];

  const textSizeStyle = { fontSize: `${settings.text_size || 16}px` };
  const alignStyle = (() => {
    if (settings.alignment === "left") return { justifyContent: "flex-start" };
    if (settings.alignment === "right") return { justifyContent: "flex-end" };
    return { justifyContent: "center" };
  })();
  const imageShape = settings.custom_border_radius_enabled && settings.custom_border_radius !== ''
    ? `${settings.custom_border_radius}px`
    : settings.layout === "square" ? "8px" : "50%";

  const imageSizePx = settings.image_size === 'small' ? 48 : settings.image_size === 'large' ? 120 : 80;

  return (
    <Frame>
      <Page title="Widget Settings">
        <BlockStack gap="400">
          <Card>
            <BlockStack gap="400">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Text variant="headingMd">Block Settings</Text>
                <Button primary onClick={handleSave}>Save</Button>
              </div>
              {showBanner && (
                <Banner status="info" title="Settings saved!" onDismiss={() => setShowBanner(false)} />
              )}
              <Select
                label="Layout style"
                options={layoutOptions}
                value={settings.layout}
                onChange={val => handleChange("layout", val)}
              />
                <Checkbox
                label="Show image"
                checked={settings.show_image}
                onChange={val => handleChange("show_image", val)}
                helpText="Show or hide the subcategory image."
              />
              <Select
                label="Image size"
                options={[
                  { label: 'Small', value: 'small' },
                  { label: 'Medium', value: 'medium' },
                  { label: 'Large', value: 'large' }
                ]}
                value={settings.image_size || 'medium'}
                onChange={val => handleChange('image_size', val)}
                helpText="Set the size of subcategory images."
              />

              <Checkbox
                label="Show title"
                checked={settings.show_title}
                onChange={val => handleChange("show_title", val)}
                helpText="Show or hide the subcategory title."
              />
              <TextField
                label="Text size (px)"
                type="text"
                value={String(settings.text_size)}
                onChange={val => handleChange("text_size", val)}
                helpText="Set the font size for subcategory titles in pixels."
              />
              <BlockStack gap="100">
                <Text variant="bodyMd" fontWeight="regular" style={{ marginBottom: 4 }}>Choose text transform</Text>
                <div style={{ display: 'flex', gap: 0 }}>
                  {['lowercase', 'uppercase', 'capitalize', 'none'].map((val, idx, arr) => (
                    <button
                      key={val}
                      type="button"
                      style={{
                        padding: '8px 20px',
                        border: '1px solid #bbb',
                        borderRight: idx !== arr.length - 1 ? 'none' : '1px solid #bbb',
                        background: settings.text_transform === val ? '#E3E4E6' : '#fff',
                        color: '#222',
                        fontWeight: settings.text_transform === val ? 600 : 400,
                        outline: 'none',
                        cursor: 'pointer',
                        borderTopLeftRadius: idx === 0 ? 8 : 0,
                        borderBottomLeftRadius: idx === 0 ? 8 : 0,
                        borderTopRightRadius: idx === arr.length - 1 ? 8 : 0,
                        borderBottomRightRadius: idx === arr.length - 1 ? 8 : 0,
                        boxShadow: 'none',
                        transition: 'all 0.15s',
                      }}
                      onClick={() => handleChange('text_transform', val)}
                    >
                      {val === 'lowercase' && 'Lowercase'}
                      {val === 'uppercase' && 'Uppercase'}
                      {val === 'capitalize' && 'Capitalize'}
                      {val === 'none' && 'As is'}
                    </button>
                  ))}
                </div>
              </BlockStack>
              <Checkbox
                label="Bold subcategory titles"
                checked={settings.bold_titles || false}
                onChange={val => handleChange("bold_titles", val)}
                helpText="Make subcategory titles bold."
              />
              <BlockStack gap="200">
                <Text>Alignment</Text>
                <InlineStack gap="200">
                  {alignmentOptions.map(opt => (
                    <RadioButton
                      key={opt.value}
                      label={opt.label}
                      checked={settings.alignment === opt.value}
                      id={opt.value}
                      name="alignment"
                      onChange={() => handleChange("alignment", opt.value)}
                    />
                  ))}
                </InlineStack>
              </BlockStack>
              <Checkbox
                label="Show heading"
                checked={settings.show_heading}
                onChange={val => handleChange("show_heading", val)}
              />
              {settings.show_heading && (
                <TextField
                  label="Heading text"
                  value={settings.heading_text}
                  onChange={val => handleChange("heading_text", val)}
                />
              )}
              <Checkbox
                label="Add scroll"
                checked={settings.scroll_enabled}
                onChange={val => handleChange("scroll_enabled", val)}
                helpText="If unchecked, subcategories will be shown in a grid format."
              />
              <Checkbox
                label="Enable custom border radius"
                checked={settings.custom_border_radius_enabled}
                onChange={val => handleChange("custom_border_radius_enabled", val)}
                helpText="Override the default border radius for images."
              />
              {settings.custom_border_radius_enabled && (
                <TextField
                  label="Custom border radius (px)"
                  type="text"
                  value={String(settings.custom_border_radius)}
                  onChange={val => handleChange("custom_border_radius", val)}
                  helpText="Set a custom border radius in pixels (e.g., 20 for 20px)."
                />
              )}
              <Checkbox
                label="Show product count badge"
                checked={settings.show_product_count}
                onChange={val => handleChange("show_product_count", val)}
                helpText="Display the number of products in each subcategory as a badge."
              />
              {settings.show_product_count && (
                <>
                  <InlineStack gap="200" blockAlign="center">
                    <Box minWidth="40px" maxWidth="40px" minHeight="32px" maxHeight="32px" padding="0">
                      <input
                        type="color"
                        value={settings.bubble_bg_color}
                        onChange={e => handleChange("bubble_bg_color", e.target.value)}
                        style={{ width: 32, height: 32, border: 'none', background: 'none', padding: 0, display: 'block' }}
                        aria-label="Bubble background color"
                      />
                    </Box>
                    <Text variant="bodySm">Bubble background color</Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="center">
                    <Box minWidth="40px" maxWidth="40px" minHeight="32px" maxHeight="32px" padding="0">
                      <input
                        type="color"
                        value={settings.bubble_text_color}
                        onChange={e => handleChange("bubble_text_color", e.target.value)}
                        style={{ width: 32, height: 32, border: 'none', background: 'none', padding: 0, display: 'block' }}
                        aria-label="Bubble text color"
                      />
                    </Box>
                    <Text variant="bodySm">Bubble text color</Text>
                  </InlineStack>
                </>
              )}
              <TextField
                label="Section padding (px)"
                type="number"
                value={String(settings.section_padding)}
                onChange={val => handleChange("section_padding", val)}
                helpText="Padding around the subcategory section."
                min={0}
                max={64}
              />
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd">Live Preview</Text>
              <InlineStack gap="200">
                <Button
                  icon={DesktopIcon}
                  pressed={previewMode === "desktop"}
                  onClick={() => setPreviewMode("desktop")}
                >Desktop</Button>
                <Button
                  icon={MobileIcon}
                  pressed={previewMode === "mobile"}
                  onClick={() => setPreviewMode("mobile")}
                >Mobile</Button>
              </InlineStack>
              <div
                style={{
                  border: "1px solid #E1E3E5",
                  borderRadius: 8,
                  padding: 24,
                  background: "#fafbfc",
                  width: previewMode === "mobile" ? 340 : 700,
                  margin: "0 auto"
                }}
              >
                {settings.show_heading && (
                  <h2 style={{
                    marginBottom: 24,
                    textAlign: settings.alignment
                  }}>{settings.heading_text}</h2>
                )}
                <div
                  style={{
                    display: "flex",
                    flexWrap: settings.scroll_enabled ? undefined : "wrap",
                    gap: 24,
                    ...alignStyle,
                    overflowX: settings.scroll_enabled ? "auto" : undefined,
                    whiteSpace: settings.scroll_enabled ? "nowrap" : undefined,
                    scrollBehavior: settings.scroll_enabled ? "smooth" : undefined,
                    scrollSnapType: settings.scroll_enabled ? "x mandatory" : undefined
                  }}
                >
                  {settings.scroll_enabled ? (
                    <div style={{ whiteSpace: "nowrap", overflowX: "auto", display: "flex", gap: 24, paddingTop: 8 }}>
                      {dummySubcats.map((subcat, idx) => (
                        <div key={idx} style={{
                          display: "inline-flex",
                          flexDirection: "column",
                          alignItems: "center",
                          width: 110
                        }}>
                          {settings.show_image && (
                            <div style={{
                              position: 'relative',
                              width: imageSizePx,
                              height: imageSizePx,
                              borderRadius: imageShape,
                              background: '#f6f6f7',
                              boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              marginBottom: 8
                            }}>
                              {settings.show_product_count && subcat.products_count > 0 && (
                                <span style={{
                                  position: 'absolute',
                                  top: -6,
                                  right: -6,
                                  minWidth: 24,
                                  height: 24,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  background: settings.bubble_bg_color,
                                  color: settings.bubble_text_color,
                                  borderRadius: '999px',
                                  fontSize: 14,
                                  fontWeight: 600,
                                  padding: '0 7px',
                                  boxShadow: '0 1px 4px #0001',
                                  zIndex: 2
                                }}>{subcat.products_count}</span>
                              )}
                              <img
                                src={subcat.image}
                                alt={subcat.title}
                                style={{
                                  width: imageSizePx,
                                  height: imageSizePx,
                                  objectFit: 'cover',
                                  borderRadius: imageShape
                                }}
                              />
                            </div>
                          )}
                          {settings.show_title && (
                            <div style={{
                              textAlign: 'center',
                              fontWeight: settings.bold_titles ? 700 : 500,
                              maxWidth: 100,
                              whiteSpace: 'normal',
                              fontSize: `${settings.text_size || 16}px`,
                              textTransform: settings.text_transform === 'none' ? undefined : settings.text_transform
                            }}>
                              {subcat.title}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    dummySubcats.map((subcat, idx) => (
                      <div key={idx} style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        width: 110
                      }}>
                        {settings.show_image && (
                          <div style={{
                            position: 'relative',
                            width: imageSizePx,
                            height: imageSizePx,
                            borderRadius: imageShape,
                            background: '#f6f6f7',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginBottom: 8
                          }}>
                            {settings.show_product_count && subcat.products_count > 0 && (
                              <span style={{
                                position: 'absolute',
                                top: -6,
                                right: -6,
                                minWidth: 24,
                                height: 24,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: settings.bubble_bg_color,
                                color: settings.bubble_text_color,
                                borderRadius: '999px',
                                fontSize: 14,
                                fontWeight: 600,
                                padding: '0 7px',
                                boxShadow: '0 1px 4px #0001',
                                zIndex: 2
                              }}>{subcat.products_count}</span>
                            )}
                            <img
                              src={subcat.image}
                              alt={subcat.title}
                              style={{
                                width: imageSizePx,
                                height: imageSizePx,
                                objectFit: 'cover',
                                borderRadius: imageShape
                              }}
                            />
                          </div>
                        )}
                        {settings.show_title && (
                          <div style={{
                            textAlign: 'center',
                            fontWeight: settings.bold_titles ? 700 : 500,
                            maxWidth: 100,
                            whiteSpace: 'normal',
                            fontSize: `${settings.text_size || 16}px`,
                            textTransform: settings.text_transform === 'none' ? undefined : settings.text_transform
                          }}>
                            {subcat.title}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </BlockStack>
          </Card>
        </BlockStack>
      </Page>
    </Frame>
  );
}