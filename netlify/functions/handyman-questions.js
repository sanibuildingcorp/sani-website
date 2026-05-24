// netlify/functions/handyman-questions.js
// Returns dynamic questions for each handyman service
// Usage: GET /.netlify/functions/handyman-questions?service=painting-touchups

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }

  const serviceId = (event.queryStringParameters || {}).service;
  if (!serviceId) {
    return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Missing service parameter" }) };
  }

  const questions = QUESTIONS[serviceId];
  if (!questions) {
    return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: "Service not found" }) };
  }

  return {
    statusCode: 200,
    headers: cors(),
    body: JSON.stringify({ service: serviceId, questions: questions }),
  };
};

const QUESTIONS = {
  "general-repairs": [
    { id: "repair_type", label: "What needs repair?", type: "multi_select", required: true,
      options: ["Door", "Window", "Lock", "Hinge", "Drywall", "Caulking", "Cabinet", "Shelf", "Other"] },
    { id: "issue_count", label: "How many separate issues to fix?", type: "single_select", required: true,
      options: ["1 issue", "2-3 issues", "4-5 issues", "6+ issues"] },
    { id: "broken_missing", label: "Is anything broken or missing?", type: "single_select", required: true,
      options: ["Yes, fully broken", "Partially broken", "Just loose/wobbly", "Just needs adjustment"] },
    { id: "has_parts", label: "Do you already have the parts/replacement?", type: "single_select", required: true,
      options: ["Yes, I have everything", "I have some parts", "No, you bring everything", "Not sure"] },
    { id: "urgency", label: "How urgent is this?", type: "single_select", required: true,
      options: ["Emergency today", "This week", "Within 2 weeks", "Flexible"] },
    { id: "description", label: "Describe what needs to be fixed", type: "textarea", required: true,
      placeholder: "Example: Front door won't close properly, hinge is loose..." }
  ],

  "painting-touchups": [
    { id: "surface", label: "What surface needs painting?", type: "multi_select", required: true,
      options: ["Wall", "Ceiling", "Trim/Baseboard", "Door", "Cabinet", "Other"] },
    { id: "damage_count", label: "How many damaged areas?", type: "single_select", required: true,
      options: ["1-2 spots", "3-5 spots", "6-10 spots", "More than 10 / whole wall"] },
    { id: "damage_size", label: "Approximate size of damage?", type: "single_select", required: true,
      options: ["Small (coin-size)", "Medium (palm-size)", "Large (plate-size)", "Very large (multiple feet)"] },
    { id: "has_paint", label: "Do you have matching paint?", type: "single_select", required: true,
      options: ["Yes, I have the exact paint", "Yes, but not sure if it matches", "No, you provide paint", "Need to match existing color"] },
    { id: "damage_type", label: "What type of damage?", type: "multi_select", required: false,
      options: ["Peeling paint", "Water damage", "Holes", "Cracks", "Scuffs/marks", "Stains"] },
    { id: "description", label: "Additional details", type: "textarea", required: false,
      placeholder: "Example: Living room walls have 3 patches from removing wall art..." }
  ],

  "furniture-assembly": [
    { id: "furniture_type", label: "What type of furniture?", type: "multi_select", required: true,
      options: ["Bed frame", "Wardrobe/Closet", "Desk", "Bookshelf", "Table", "Chair", "Dresser", "TV stand", "Other"] },
    { id: "quantity", label: "How many pieces total?", type: "single_select", required: true,
      options: ["1 piece", "2-3 pieces", "4-5 pieces", "6+ pieces"] },
    { id: "complexity", label: "Approximate size/complexity?", type: "single_select", required: true,
      options: ["Small/Simple (1 hour)", "Medium (1-2 hours each)", "Large/Complex (3+ hours each)"] },
    { id: "brand", label: "Brand (if known)?", type: "single_select", required: false,
      options: ["IKEA", "Wayfair", "Amazon Basics", "Other big box", "Custom/Unknown"] },
    { id: "has_tools", label: "Are all parts and instructions present?", type: "single_select", required: true,
      options: ["Yes, unopened box", "Yes, parts checked", "Not sure", "Some pieces missing"] },
    { id: "description", label: "Additional details", type: "textarea", required: false,
      placeholder: "Example: Queen bed frame from IKEA Malm series, all parts in original box..." }
  ],

  "leak-plumbing": [
    { id: "issue_type", label: "What type of plumbing issue?", type: "multi_select", required: true,
      options: ["Faucet leaking", "Faucet replacement", "Clogged drain", "Running toilet", "Toilet repair", "Showerhead replacement", "Supply line issue", "Other"] },
    { id: "location", label: "Where is the issue?", type: "single_select", required: true,
      options: ["Kitchen", "Bathroom", "Laundry", "Outdoor", "Multiple locations"] },
    { id: "brand_model", label: "Brand/Model (if known)", type: "text", required: false,
      placeholder: "Example: Delta, Kohler, Moen" },
    { id: "water_shutoff", label: "Does the water shutoff valve work?", type: "single_select", required: true,
      options: ["Yes, works fine", "Yes, but stiff", "Not sure / haven't tried", "No, doesn't work"] },
    { id: "has_replacement", label: "Do you have a replacement part/fixture?", type: "single_select", required: true,
      options: ["Yes, I have it", "Need to buy one - have selected", "Need help choosing", "Hope it can be repaired"] },
    { id: "urgency", label: "How urgent?", type: "single_select", required: true,
      options: ["Active leak NOW (emergency)", "Slow leak / dripping", "Annoying but stable", "Flexible timing"] },
    { id: "description", label: "Describe the issue", type: "textarea", required: true,
      placeholder: "Example: Kitchen faucet drips from base, started last week..." }
  ],

  "tile-grout": [
    { id: "issue_type", label: "What needs tile/grout work?", type: "multi_select", required: true,
      options: ["Cracked/broken tiles", "Loose tiles", "Regrouting needed", "Recaulking needed", "Stain removal", "Other"] },
    { id: "location", label: "Where is the work?", type: "multi_select", required: true,
      options: ["Bathroom floor", "Bathroom walls/shower", "Kitchen floor", "Kitchen backsplash", "Other"] },
    { id: "area_size", label: "Approximate area?", type: "single_select", required: true,
      options: ["A few tiles", "Small area (under 10 sq ft)", "Medium area (10-30 sq ft)", "Large area (30+ sq ft)"] },
    { id: "broken_tiles", label: "How many broken/cracked tiles?", type: "single_select", required: false,
      options: ["None", "1-2", "3-5", "6-10", "More than 10"] },
    { id: "has_replacement_tiles", label: "Do you have matching replacement tiles?", type: "single_select", required: true,
      options: ["Yes, exact match", "Yes, but maybe different batch", "No - help me match", "No replacement needed"] },
    { id: "description", label: "Additional details", type: "textarea", required: false,
      placeholder: "Example: Master bathroom shower has 3 cracked tiles and grout is mildewed..." }
  ],

  "light-electrical": [
    { id: "issue_type", label: "What electrical work?", type: "multi_select", required: true,
      options: ["Light fixture install", "Light fixture replace", "Ceiling fan install", "Outlet replacement", "Switch replacement", "Outlet cover", "Other"] },
    { id: "quantity", label: "How many items?", type: "single_select", required: true,
      options: ["1 item", "2-3 items", "4-5 items", "6+ items"] },
    { id: "has_fixture", label: "Do you have the new fixture/part?", type: "single_select", required: true,
      options: ["Yes, I have everything", "Most items", "No, you provide", "Need help selecting"] },
    { id: "working_now", label: "Is the existing fixture/outlet working?", type: "single_select", required: true,
      options: ["Yes, just replacing", "No, doesn't work at all", "Works intermittently", "Not yet installed (new)"] },
    { id: "ceiling_height", label: "Ceiling height (for ceiling work)?", type: "single_select", required: false,
      options: ["Standard (8 ft)", "Tall (9-10 ft)", "Very tall (10+ ft)", "Not applicable"] },
    { id: "description", label: "Describe the work", type: "textarea", required: true,
      placeholder: "Example: Need to replace 2 dining room light fixtures, have new chandelier..." }
  ],

  "full-handyman-day": [
    { id: "job_count", label: "How many jobs?", type: "single_select", required: true,
      options: ["3-5 jobs", "6-8 jobs", "9-12 jobs", "12+ jobs (may need 2 days)"] },
    { id: "job_categories", label: "What categories of work?", type: "multi_select", required: true,
      options: ["General repairs", "Painting", "Plumbing", "Electrical", "Furniture/Mounting", "Tile/Caulk", "Other"] },
    { id: "property_type", label: "Property type?", type: "single_select", required: true,
      options: ["Apartment", "Single family home", "Brownstone", "Multi-unit building", "Commercial space"] },
    { id: "materials_provided", label: "Will you provide materials?", type: "single_select", required: true,
      options: ["Yes, I have all materials", "Mostly", "Some - need help with rest", "No, you provide everything"] },
    { id: "description", label: "List the jobs you need done", type: "textarea", required: true,
      placeholder: "Example:\n1. Fix loose bedroom door\n2. Patch 4 holes in living room wall\n3. Install ceiling fan in kitchen\n..." }
  ],

  "property-manager": [
    { id: "building_type", label: "Type of property?", type: "single_select", required: true,
      options: ["Single building", "2-5 buildings", "Property management firm", "Single landlord with units"] },
    { id: "unit_count", label: "Total number of units?", type: "single_select", required: true,
      options: ["Under 10 units", "10-25 units", "26-50 units", "50+ units"] },
    { id: "service_type", label: "What type of service?", type: "multi_select", required: true,
      options: ["Turnover/Make-ready repairs", "Ongoing maintenance contract", "On-call repairs", "Emergency response", "Specific project"] },
    { id: "frequency", label: "How often do you need service?", type: "single_select", required: true,
      options: ["Weekly", "Bi-weekly", "Monthly", "As-needed", "Single project"] },
    { id: "current_need", label: "Current immediate need?", type: "textarea", required: true,
      placeholder: "Example: 3-unit building in Park Slope, need turnover repairs in Unit 2 - paint, drywall, replace 2 light fixtures..." }
  ],
};

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
  };
}
