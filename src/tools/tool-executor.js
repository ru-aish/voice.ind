/**
 * Tool Executor
 * 
 * Executes tool calls directly using Google Calendar service
 * Independent of external API calls
 */

const { getCalendarService } = require('../core/calendar/google-calendar');
const {
  formatDateInTimeZone,
  convertDateTimeStringsToInstantMs,
} = require('../utils/timezone-utils');

class ToolExecutor {
  constructor(config = {}) {
    this.config = config;
    this.calendarService = null;
    this.defaultTimezone =
      config.defaultTimezone ||
      process.env.BOOKING_TIMEZONE ||
      process.env.DEFAULT_TIMEZONE ||
      Intl.DateTimeFormat().resolvedOptions().timeZone ||
      'UTC';
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
  async execute(toolName, args = {}) {
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
    const safeArgs = args || {};
    console.log('📝 Lead info captured:', safeArgs.name, safeArgs.email);
    return {
      success: true,
      message: `Lead info captured for ${safeArgs.name || 'unknown lead'}`,
      data: safeArgs
    };
  }

  /**
   * Check available time slots using Google Calendar
   */
  async checkAvailability(args) {
    try {
      const calendar = this.getCalendarService();
      const timezone = args.timezone || this.defaultTimezone;
      
      // Get date (default to today)
      const date = args.date || formatDateInTimeZone(new Date(), timezone);
      const timePreference = args.timePreference || 'any';

      // Filter out past slots if date is today
      const today = formatDateInTimeZone(new Date(), timezone);
      const isToday = date === today;

      let availableSlots = await calendar.getAvailableSlots(date, timePreference, timezone);

      // Filter past slots for today
      if (isToday) {
        const nowInstant = Date.now();
        const oneHourMs = 60 * 60 * 1000;
        const minAllowedInstant = nowInstant + oneHourMs;

        availableSlots = availableSlots.filter(slot => {
          const slotInstant = convertDateTimeStringsToInstantMs(date, slot, timezone);
          return slotInstant >= minAllowedInstant;
        });
      }

      return {
        success: true,
        date,
        timezone,
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
      const safeArgs = args || {};
      const timezone = safeArgs.timezone || this.defaultTimezone;

      // Validate required fields
      if (!safeArgs.leadName) {
        return { success: false, error: 'Missing leadName' };
      }
      if (!safeArgs.email) {
        return { success: false, error: 'Missing email' };
      }
      if (!safeArgs.date) {
        return { success: false, error: 'Missing date' };
      }
      if (!safeArgs.time) {
        return { success: false, error: 'Missing time' };
      }

      // Validate email format
      if (!safeArgs.email.includes('@')) {
        return { success: false, error: 'Invalid email format' };
      }

      // Validate date format (YYYY-MM-DD)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(safeArgs.date)) {
        return { success: false, error: 'Invalid date format. Use YYYY-MM-DD' };
      }

      // Validate time format (HH:MM)
      if (!/^\d{2}:\d{2}$/.test(safeArgs.time)) {
        return { success: false, error: 'Invalid time format. Use HH:MM' };
      }

      // Check if booking is in the past
      const bookingInstant = convertDateTimeStringsToInstantMs(
        safeArgs.date,
        safeArgs.time,
        timezone
      );
      if (Number.isNaN(bookingInstant)) {
        return { success: false, error: 'Invalid date/time values' };
      }
      if (bookingInstant < Date.now()) {
        return { success: false, error: 'Cannot book appointments in the past' };
      }

      const calendar = this.getCalendarService();

      const result = await calendar.bookAppointment({
        leadName: safeArgs.leadName.trim().substring(0, 100),
        email: safeArgs.email.trim().toLowerCase().substring(0, 100),
        phone: safeArgs.phone?.trim().substring(0, 20),
        company: safeArgs.company?.trim().substring(0, 100),
        date: safeArgs.date.trim(),
        time: safeArgs.time.trim(),
        duration: safeArgs.duration || '60',
        notes: safeArgs.notes?.trim().substring(0, 500),
        timezone
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
