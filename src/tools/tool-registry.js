const captureLeadInfo = {
  name: "capture_lead_info",
  description: "Captures contact information from a potential customer. Use when customer provides name, email, phone, or company.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Full name" },
      email: { type: "string", description: "Email address" },
      phone: { type: "string", description: "Phone number" },
      company: { type: "string", description: "Company name" },
      interest: { type: "string", description: "Product/service interest" }
    },
    required: ["name"]
  }
};

const checkAvailability = {
  name: "check_availability",
  description: "Check available time slots for scheduling a demo. Use when customer asks about available times.",
  parameters: {
    type: "object",
    properties: {
      date: { type: "string", description: "Date in YYYY-MM-DD format" },
      timePreference: { type: "string", enum: ["morning", "afternoon", "evening", "any"] }
    },
    required: []
  }
};

const bookDemo = {
  name: "book_demo",
  description: "Book a demo appointment. Use after confirming customer wants to schedule at a specific time.",
  parameters: {
    type: "object",
    properties: {
      leadName: { type: "string", description: "Name of person booking" },
      email: { type: "string", description: "Email for confirmation" },
      phone: { type: "string", description: "Phone number" },
      company: { type: "string", description: "Company name" },
      date: { type: "string", description: "Date in YYYY-MM-DD format" },
      time: { type: "string", description: "Time in HH:MM format (24-hour)" },
      duration: { type: "string", enum: ["30", "60", "90"] },
      notes: { type: "string", description: "Special requests" }
    },
    required: ["leadName", "email", "date", "time"]
  }
};

module.exports = {
  toolDefinitions: [captureLeadInfo, checkAvailability, bookDemo],
  toolMap: { capture_lead_info: captureLeadInfo, check_availability: checkAvailability, book_demo: bookDemo },
  captureLeadInfo,
  checkAvailability,
  bookDemo
};
