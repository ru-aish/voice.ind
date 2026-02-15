/**
 * Tool Executor
 * 
 * Executes tool calls directly using Google Calendar service
 * Independent of external API calls
 */

const { getCalendarService } = require('../core/calendar/google-calendar');

class ToolExecutor {
  constructor(config = {}) {
    this.config = config;
    this.calendarService = null;
  }

  /**
   * Get or initialize calendar service (lazy loading)
   */
  getCalendarService() {
    if (!this.calendarService) {
      this.calendarService = getCalendarService(this.config);
    }
    return this.calendarService;
  }

  /**
   * Execute a tool by name
   */
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

  /**
   * Capture lead information
   * For now, just returns the captured data
   * Could be extended to save to a database
   */
  async captureLeadInfo(args) {
    console.log('📝 Lead info captured:', args.name, args.email);
    return {
      success: true,
      message: `Lead info captured for ${args.name}`,
      data: args
    };
  }

  /**
   * Check available time slots using Google Calendar
   */
  async checkAvailability(args) {
    try {
      const calendar = this.getCalendarService();
      
      // Get date (default to today)
      const date = args.date || new Date().toISOString().split('T')[0];
      const timePreference = args.timePreference || 'any';

      // Filter out past slots if date is today
      const today = new Date().toISOString().split('T')[0];
      const isToday = date === today;

      let availableSlots = await calendar.getAvailableSlots(date, timePreference);

      // Filter past slots for today
      if (isToday) {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();

        availableSlots = availableSlots.filter(slot => {
          const [slotHour, slotMinute] = slot.split(':').map(Number);
          const bufferHour = currentHour + 1;

          if (slotHour > bufferHour) return true;
          if (slotHour === bufferHour && slotMinute > currentMinute) return true;
          return false;
        });
      }

      return {
        success: true,
        date,
        timePreference,
        availableSlots,
        count: availableSlots.length
      };
    } catch (error) {
      console.error('Error checking availability:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Book a demo appointment using Google Calendar
   */
  async bookDemo(args) {
    try {
      // Validate required fields
      if (!args.leadName) {
        return { success: false, error: 'Missing leadName' };
      }
      if (!args.email) {
        return { success: false, error: 'Missing email' };
      }
      if (!args.date) {
        return { success: false, error: 'Missing date' };
      }
      if (!args.time) {
        return { success: false, error: 'Missing time' };
      }

      // Validate email format
      if (!args.email.includes('@')) {
        return { success: false, error: 'Invalid email format' };
      }

      // Validate date format (YYYY-MM-DD)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
        return { success: false, error: 'Invalid date format. Use YYYY-MM-DD' };
      }

      // Validate time format (HH:MM)
      if (!/^\d{2}:\d{2}$/.test(args.time)) {
        return { success: false, error: 'Invalid time format. Use HH:MM' };
      }

      // Check if booking is in the past
      const bookingDate = new Date(`${args.date}T${args.time}:00`);
      if (bookingDate < new Date()) {
        return { success: false, error: 'Cannot book appointments in the past' };
      }

      const calendar = this.getCalendarService();

      const result = await calendar.bookAppointment({
        leadName: args.leadName.trim().substring(0, 100),
        email: args.email.trim().toLowerCase().substring(0, 100),
        phone: args.phone?.trim().substring(0, 20),
        company: args.company?.trim().substring(0, 100),
        date: args.date.trim(),
        time: args.time.trim(),
        duration: args.duration || '60',
        notes: args.notes?.trim().substring(0, 500),
        timezone: args.timezone || 'Asia/Kolkata'
      });

      return result;
    } catch (error) {
      console.error('Error booking demo:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = { ToolExecutor };
