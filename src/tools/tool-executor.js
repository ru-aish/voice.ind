class ToolExecutor {
  constructor(config = {}) {
    this.apiBaseUrl = config.apiBaseUrl || process.env.CALENDAR_API_URL || 'http://localhost:3002';
  }

  async execute(toolName, args) {
    switch (toolName) {
      case 'capture_lead_info':
        return await this.captureLeadInfo(args);
      case 'check_availability':
        return await this.checkAvailability(args);
      case 'book_demo':
        return await this.bookDemo(args);
      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  }

  async captureLeadInfo(args) {
    return { success: true, message: `Lead info captured: ${args.name}`, data: args };
  }

  async checkAvailability(args) {
    try {
      const url = new URL(`${this.apiBaseUrl}/api/calendar/availability`);
      if (args.date) url.searchParams.set('date', args.date);
      
      const response = await fetch(url.toString());
      const data = await response.json();
      
      return {
        success: data.success,
        availableSlots: data.availableSlots || [],
        date: data.date,
        error: data.error
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async bookDemo(args) {
    try {
      const response = await fetch(`${this.apiBaseUrl}/api/calendar/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args)
      });
      const data = await response.json();
      
      return {
        success: data.success,
        message: data.message,
        eventId: data.eventId,
        eventLink: data.eventLink,
        error: data.error
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = { ToolExecutor };
