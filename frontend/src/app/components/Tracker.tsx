'use client';

/**
 * Activity Timeline Tracker Component
 * 
 * Records user interactions as a chronological timeline:
 * - Session start/end
 * - Tab visibility changes
 * - Button/element clicks (with data-track attribute)
 * - Form field focus and submit
 * - API calls (calendar, booking, lead creation)
 * - Section views (via Intersection Observer)
 * 
 * Usage:
 * Add <Tracker /> to your layout
 * Add data-track="action_code" to interactive elements
 * Add data-track-view="view_hero" to sections for scroll tracking
 * 
 * Action codes are defined in the action_types database table.
 * Common codes: mic_start, mic_stop, mode_demo, mode_web, hero_trial, etc.
 * Section view codes: view_hero, view_problem, view_solution, view_pricing, view_faq, etc.
 */

import { useEffect, useRef, useCallback } from 'react';

// Configuration
const TRACKING_ENDPOINT = '/api/tracking/event';
const BATCH_INTERVAL = 3000;  // Send batched actions every 3 seconds
const DEBUG = process.env.NODE_ENV === 'development';

// Action queue for batching
interface QueuedAction {
    action: string;      // Action code (e.g., 'mic_start')
    t_ms: number;        // Milliseconds since session start
    extra?: string;      // Optional extra data
}

let actionQueue: QueuedAction[] = [];

// Session start time (milliseconds)
let sessionStartTime: number = 0;

// Track if session_start has been sent
let sessionStartSent = false;

/**
 * Get current timestamp in milliseconds since session start
 */
function getTimestamp(): number {
    if (!sessionStartTime) {
        sessionStartTime = Date.now();
    }
    return Date.now() - sessionStartTime;
}

/**
 * Send actions to tracking API
 */
async function sendActions(actions: QueuedAction[]): Promise<boolean> {
    if (actions.length === 0) return true;

    try {
        const response = await fetch(TRACKING_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actions }),
            credentials: 'include'  // Include session cookies
        });

        if (!response.ok) {
            if (DEBUG) console.warn('[Tracker] API error:', response.status);
            return false;
        }

        if (DEBUG) {
            console.log('[Tracker] Sent actions:', actions.map(a => 
                `${formatTime(a.t_ms)} ${a.action}${a.extra ? ` (${a.extra})` : ''}`
            ));
        }
        return true;
    } catch (error) {
        if (DEBUG) console.warn('[Tracker] Send failed:', error);
        return false;
    }
}

/**
 * Format milliseconds to MM:SS.mmm
 */
function formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const millis = ms % 1000;
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

/**
 * Queue an action for sending
 */
function queueAction(action: string, extra?: string) {
    const t_ms = getTimestamp();
    
    actionQueue.push({
        action,
        t_ms,
        extra
    });

    if (DEBUG) {
        console.log(`[Tracker] ${formatTime(t_ms)} ${action}${extra ? ` (${extra})` : ''}`);
    }
}

/**
 * Send an action immediately (for critical actions like form submit)
 */
async function sendActionNow(action: string, extra?: string) {
    const t_ms = getTimestamp();
    
    if (DEBUG) {
        console.log(`[Tracker] ${formatTime(t_ms)} ${action}${extra ? ` (${extra})` : ''} [immediate]`);
    }
    
    await sendActions([{ action, t_ms, extra }]);
}

/**
 * Tracker Component
 */
export function Tracker() {
    const batchIntervalRef = useRef<NodeJS.Timeout | undefined>(undefined);

    // Flush action queue
    const flushActions = useCallback(async () => {
        if (actionQueue.length === 0) return;
        
        const actionsToSend = [...actionQueue];
        actionQueue = [];
        
        const success = await sendActions(actionsToSend);
        if (!success) {
            // Re-queue failed actions
            actionQueue = [...actionsToSend, ...actionQueue];
        }
    }, []);

    useEffect(() => {
        // Initialize session
        sessionStartTime = Date.now();
        sessionStartSent = false;

        // Record session start
        if (!sessionStartSent) {
            queueAction('session_start');
            sessionStartSent = true;
        }

        // ========================================
        // Tab Visibility Tracking
        // ========================================
        const handleVisibilityChange = () => {
            if (document.hidden) {
                queueAction('tab_hidden');
            } else {
                queueAction('tab_visible');
            }
        };

        // ========================================
        // Click Tracking (elements with data-track)
        // ========================================
        const handleClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            const trackElement = target.closest('[data-track]') as HTMLElement;
            
            if (trackElement) {
                const actionCode = trackElement.getAttribute('data-track');
                if (actionCode) {
                    // Check for extra data attribute
                    const extraData = trackElement.getAttribute('data-track-extra');
                    queueAction(actionCode, extraData || undefined);
                }
            }
        };

        // ========================================
        // Form Field Focus Tracking
        // ========================================
        const handleFocusIn = (e: FocusEvent) => {
            const target = e.target as HTMLElement;
            
            // Check if the element itself has data-track
            const trackAttr = target.getAttribute('data-track');
            if (trackAttr) {
                queueAction(trackAttr);
                return;
            }
            
            // Check for input/textarea/select with name or id
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
                const inputEl = target as HTMLInputElement;
                const fieldName = inputEl.name || inputEl.id || inputEl.type;
                
                // Map common field names to action codes
                const fieldActionMap: Record<string, string> = {
                    'name': 'form_name_focus',
                    'fullName': 'form_name_focus',
                    'full_name': 'form_name_focus',
                    'email': 'form_email_focus',
                    'workEmail': 'form_email_focus',
                    'work_email': 'form_email_focus',
                    'company': 'form_company_focus',
                    'companyName': 'form_company_focus',
                    'phone': 'form_phone_focus',
                    'phoneNumber': 'form_phone_focus',
                    'date': 'form_date_focus',
                    'preferredDate': 'form_date_focus',
                    'time': 'form_time_focus',
                    'preferredTime': 'form_time_focus',
                };
                
                const actionCode = fieldActionMap[fieldName];
                if (actionCode) {
                    queueAction(actionCode);
                }
            }
        };

        // ========================================
        // Form Submit Tracking
        // ========================================
        const handleSubmit = (e: Event) => {
            const form = e.target as HTMLFormElement;
            const trackAttr = form.getAttribute('data-track');
            
            if (trackAttr) {
                sendActionNow(trackAttr);  // Send immediately
            } else {
                sendActionNow('form_submit');
            }
        };

        // ========================================
        // Section View Tracking (Intersection Observer)
        // Tracks sections with data-track-view attribute
        // Only fires once per section per session
        // ========================================
        const viewedSections = new Set<string>();
        let sectionObserver: IntersectionObserver | null = null;

        const setupSectionObserver = () => {
            // Get all elements with data-track-view attribute
            const sections = document.querySelectorAll('[data-track-view]');
            
            if (sections.length === 0) {
                if (DEBUG) console.log('[Tracker] No sections with data-track-view found');
                return;
            }

            sectionObserver = new IntersectionObserver(
                (entries) => {
                    entries.forEach((entry) => {
                        if (entry.isIntersecting) {
                            const element = entry.target as HTMLElement;
                            const viewAction = element.getAttribute('data-track-view');
                            
                            if (viewAction && !viewedSections.has(viewAction)) {
                                viewedSections.add(viewAction);
                                queueAction(viewAction);
                                
                                // Stop observing this element since we only track once
                                sectionObserver?.unobserve(element);
                            }
                        }
                    });
                },
                {
                    threshold: 0.5,  // 50% of section must be visible
                    rootMargin: '0px'
                }
            );

            // Observe all sections
            sections.forEach((section) => {
                sectionObserver?.observe(section);
            });

            if (DEBUG) {
                console.log(`[Tracker] Section observer setup for ${sections.length} sections`);
            }
        };

        // Setup observer after a short delay to ensure DOM is ready
        const observerTimeout = setTimeout(setupSectionObserver, 100);

        // ========================================
        // Batch Action Sending
        // ========================================
        batchIntervalRef.current = setInterval(flushActions, BATCH_INTERVAL);

        // ========================================
        // Page Unload - Send remaining actions + session_end
        // ========================================
        const handleBeforeUnload = () => {
            // Add session_end to queue
            queueAction('session_end');
            
            // Use sendBeacon for reliable delivery on page exit
            if (actionQueue.length > 0 && navigator.sendBeacon) {
                navigator.sendBeacon(
                    TRACKING_ENDPOINT,
                    JSON.stringify({ actions: actionQueue })
                );
            }
        };

        // ========================================
        // Attach Event Listeners
        // ========================================
        document.addEventListener('visibilitychange', handleVisibilityChange);
        document.addEventListener('click', handleClick, true);  // Capture phase
        document.addEventListener('focusin', handleFocusIn);
        document.addEventListener('submit', handleSubmit);
        window.addEventListener('beforeunload', handleBeforeUnload);

        // ========================================
        // Cleanup
        // ========================================
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            document.removeEventListener('click', handleClick, true);
            document.removeEventListener('focusin', handleFocusIn);
            document.removeEventListener('submit', handleSubmit);
            window.removeEventListener('beforeunload', handleBeforeUnload);
            
            if (batchIntervalRef.current) {
                clearInterval(batchIntervalRef.current);
            }

            // Cleanup section observer
            clearTimeout(observerTimeout);
            if (sectionObserver) {
                sectionObserver.disconnect();
            }

            // Flush remaining actions
            flushActions();
        };
    }, [flushActions]);

    // This component renders nothing
    return null;
}

/**
 * Manual tracking function - can be imported and used anywhere
 * 
 * Usage:
 * import { trackAction } from '@/app/components/Tracker';
 * trackAction('mic_start');
 * trackAction('api_calendar', 'booking_request');
 */
export function trackAction(action: string, extra?: string) {
    queueAction(action, extra);
}

/**
 * Track action immediately (doesn't wait for batch)
 * Use for critical actions like form submissions
 */
export function trackActionNow(action: string, extra?: string) {
    sendActionNow(action, extra);
}

// Legacy exports for backward compatibility
export const trackEvent = trackAction;
export const trackEventNow = trackActionNow;

export default Tracker;
