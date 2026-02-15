/**
 * Google Calendar Service
 * 
 * Handles all Google Calendar API interactions for booking appointments
 * Uses Service Account authentication - no OAuth verification needed
 */

const { google } = require('googleapis');

class GoogleCalendarService {
  constructor(config = {}) {
    const serviceAccountEmail = config.serviceAccountEmail || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const serviceAccountPrivateKey = config.serviceAccountPrivateKey || process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    const keyFilePath = config.keyFilePath || process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
    const calendarId = config.calendarId || process.env.GOOGLE_CALENDAR_ID || 'primary';

    this.calendarId = calendarId;
    this.defaultTimezone =
      config.defaultTimezone ||
      process.env.BOOKING_TIMEZONE ||
      process.env.DEFAULT_TIMEZONE ||
      Intl.DateTimeFormat().resolvedOptions().timeZone ||
      'UTC';

    let auth;

    if (serviceAccountEmail && serviceAccountPrivateKey) {
      // Inline credentials (for cloud deployment)
      auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: serviceAccountEmail,
          private_key: serviceAccountPrivateKey.replace(/\\n/g, '\n'),
        },
        scopes: ['https://www.googleapis.com/auth/calendar'],
      });
    } else if (keyFilePath) {
      // JSON key file (for local development)
      const path = require('path');
      const resolvedKeyPath = path.isAbsolute(keyFilePath)
        ? keyFilePath
        : path.resolve(process.cwd(), keyFilePath);

      auth = new google.auth.GoogleAuth({
        keyFile: resolvedKeyPath,
        scopes: ['https://www.googleapis.com/auth/calendar'],
      });
    } else {
      throw new Error(
        'Google Calendar credentials not configured. ' +
        'Set either GOOGLE_SERVICE_ACCOUNT_KEY_FILE or ' +
        'GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.'
      );
    }

    this.calendar = google.calendar({ version: 'v3', auth });
  }

  /**
   * Calculate start and end datetime for an event
   */
  calculateEventTimes(date, time, durationMinutes = 60, timeZone = this.defaultTimezone) {
    const [year, month, day] = date.split('-').map(Number);
    const [hours, minutes] = time.split(':').map(Number);

    const startInstantMs = this.convertLocalDateTimeToInstantMs(
      year,
      month,
      day,
      hours,
      minutes,
      timeZone
    );
    const endInstantMs = startInstantMs + durationMinutes * 60 * 1000;
    const endParts = this.getDateTimePartsInTimeZone(endInstantMs, timeZone);

    return {
      startDateTime: this.formatLocalDateTime(year, month, day, hours, minutes),
      endDateTime: this.formatLocalDateTime(
        endParts.year,
        endParts.month,
        endParts.day,
        endParts.hour,
        endParts.minute
      ),
      startInstantMs,
      endInstantMs,
    };
  }

  formatLocalDateTime(year, month, day, hour, minute) {
    const y = String(year).padStart(4, '0');
    const m = String(month).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    const h = String(hour).padStart(2, '0');
    const min = String(minute).padStart(2, '0');
    return `${y}-${m}-${d}T${h}:${min}:00`;
  }

  getDateTimePartsInTimeZone(input, timeZone) {
    const date = input instanceof Date ? input : new Date(input);
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const byType = {};
    for (const part of parts) {
      if (part.type !== 'literal') {
        byType[part.type] = part.value;
      }
    }
    return {
      year: Number(byType.year),
      month: Number(byType.month),
      day: Number(byType.day),
      hour: Number(byType.hour),
      minute: Number(byType.minute),
      second: Number(byType.second),
    };
  }

  getTimeZoneOffsetMs(instantMs, timeZone) {
    const date = new Date(instantMs);
    const parts = this.getDateTimePartsInTimeZone(date, timeZone);
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    return asUtc - instantMs;
  }

  convertLocalDateTimeToInstantMs(year, month, day, hour, minute, timeZone) {
    const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
    let instant = utcGuess;

    for (let i = 0; i < 2; i += 1) {
      const offset = this.getTimeZoneOffsetMs(instant, timeZone);
      instant = utcGuess - offset;
    }

    return instant;
  }

  /**
   * Build event description with lead information
   */
  buildEventDescription(params) {
    let description = `Demo appointment with ${params.leadName}\n\n`;

    if (params.company) {
      description += `Company: ${params.company}\n`;
    }
    description += `Email: ${params.email}\n`;
    if (params.phone) {
      description += `Phone: ${params.phone}\n`;
    }
    if (params.notes) {
      description += `\nNotes:\n${params.notes}\n`;
    }
    description += `\n---\nBooked via Voice Agent`;

    return description;
  }

  /**
   * Generate time slots based on preference
   */
  generateTimeSlots(preference) {
    const allSlots = {
      morning: ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30'],
      afternoon: ['13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30'],
      evening: ['17:00', '17:30', '18:00', '18:30'],
    };

    if (preference === 'morning') return allSlots.morning;
    if (preference === 'afternoon') return allSlots.afternoon;
    if (preference === 'evening') return allSlots.evening;

    return [...allSlots.morning, ...allSlots.afternoon, ...allSlots.evening];
  }

  /**
   * Check if a time slot is available (no conflicts)
   */
  async checkAvailability(date, time, duration = 60, timeZone = this.defaultTimezone) {
    try {
      const { startInstantMs, endInstantMs } = this.calculateEventTimes(
        date,
        time,
        duration,
        timeZone
      );

      const response = await this.calendar.freebusy.query({
        requestBody: {
          timeMin: new Date(startInstantMs).toISOString(),
          timeMax: new Date(endInstantMs).toISOString(),
          timeZone,
          items: [{ id: this.calendarId }],
        },
      });

      const calendars = response.data.calendars;
      if (!calendars || !calendars[this.calendarId]) return false;

      const busy = calendars[this.calendarId]?.busy || [];
      return busy.length === 0;
    } catch (error) {
      console.error('Error checking availability:', error.message);
      return false;
    }
  }

  /**
   * Get available time slots for a given date
   */
  async getAvailableSlots(date, timePreference = 'any', timeZone = this.defaultTimezone) {
    const slots = this.generateTimeSlots(timePreference);
    const availableSlots = [];

    for (const slot of slots) {
      const isAvailable = await this.checkAvailability(date, slot, 60, timeZone);
      if (isAvailable) {
        availableSlots.push(slot);
      }
    }

    return availableSlots;
  }

  /**
   * Book an appointment in Google Calendar
   */
  async bookAppointment(params) {
    try {
      if (!params.leadName || !params.email || !params.date || !params.time) {
        return {
          success: false,
          message: 'Missing required fields: leadName, email, date, or time',
        };
      }

      const { startDateTime, endDateTime } = this.calculateEventTimes(
        params.date,
        params.time,
        parseInt(params.duration || '60', 10),
        params.timezone || this.defaultTimezone
      );

      const eventTimeZone = params.timezone || this.defaultTimezone;

      const event = {
        summary: `Demo with ${params.leadName}${params.company ? ` - ${params.company}` : ''}`,
        description: this.buildEventDescription(params),
        start: {
          dateTime: startDateTime,
          timeZone: eventTimeZone,
        },
        end: {
          dateTime: endDateTime,
          timeZone: eventTimeZone,
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 24 * 60 },
            { method: 'popup', minutes: 30 },
          ],
        },
        guestsCanModify: false,
        guestsCanInviteOthers: false,
        guestsCanSeeOtherGuests: false,
      };

      const response = await this.calendar.events.insert({
        calendarId: this.calendarId,
        requestBody: event,
        sendUpdates: 'none',
      });

      console.log('✅ Calendar event created:', response.data.id);

      return {
        success: true,
        message: `Appointment successfully booked for ${params.leadName} on ${params.date} at ${params.time}`,
        eventId: response.data.id || undefined,
        eventLink: response.data.htmlLink || undefined,
      };
    } catch (error) {
      console.error('❌ Error booking calendar appointment:', error.message);

      return {
        success: false,
        message: 'Failed to book appointment',
        error: error.message,
      };
    }
  }
}

// Singleton instance
let calendarServiceInstance = null;

function getCalendarService(config) {
  if (!calendarServiceInstance) {
    calendarServiceInstance = new GoogleCalendarService(config);
  }
  return calendarServiceInstance;
}

module.exports = {
  GoogleCalendarService,
  getCalendarService
};
