"use client";

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import styles from './styles.module.css';
import { trackAction } from './components/Tracker';

// Constants
const WORKING_DAYS_PER_YEAR = 260;

// Static data - moved outside component for performance
const TESTIMONIALS = [
    {
        name: "After-Hours Buyer Inquiry",
        role: "Illustrative listing workflow",
        quote: "A buyer asks about a property after hours, receives approved listing details, and submits a showing request for the agent to confirm.",
        metric: "Faster lead response",
        image: "/images/testimonials/michael.png"
    },
    {
        name: "Repetitive Listing Questions",
        role: "Illustrative team workflow",
        quote: "The assistant answers approved questions about price, layout, amenities, and availability before routing a qualified conversation to the team.",
        metric: "Less admin work",
        image: "/images/testimonials/sarah.png"
    },
    {
        name: "High-Intent Buyer Routing",
        role: "Illustrative lead workflow",
        quote: "A pre-approved buyer requesting an immediate tour is identified as high intent and sent to the listing agent with the relevant context.",
        metric: "24/7 buyer response",
        image: "/images/testimonials/james.png"
    }
];

const FEATURES = [
    {
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18" />
                <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
            </svg>
        ),
        title: "Showing Request Coordination",
        description: "Buyers can request, reschedule, or cancel property showings 24/7, with availability synchronized to your existing calendar."
    },
    {
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M9 12l2 2 4-4" />
                <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
            </svg>
        ),
        title: "Listing-Specific Answers",
        description: "Answers questions about price, layout, amenities, location, availability, and listing details using information you approve."
    },
    {
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
        ),
        title: "Lead Capture & Qualification",
        description: "Captures buyer details, timeline, financing status, and property interest, then routes qualified leads to your team or CRM."
    },
    {
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
        ),
        title: "Automated Follow-ups",
        description: "Sends showing confirmations and reminders automatically, reducing no-shows and keeping interested buyers engaged."
    },
    {
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            </svg>
        ),
        title: "Natural Voice Conversations",
        description: "Provides warm, natural voice conversations and adapts in real time while staying within your approved listing information."
    },
    {
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                <path d="m15 5 4 4" />
            </svg>
        ),
        title: "Reschedule & Cancel",
        description: "Buyers manage showing times without back-and-forth, freeing agents for negotiations, tours, and client relationships."
    },
    {
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4" />
                <path d="M12 8h.01" />
            </svg>
        ),
        title: "Property & Brokerage Information",
        description: "Answers questions about properties, neighborhoods, brokerage hours, directions, and next steps, 24 hours a day."
    },
    {
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72" />
                <path d="M15 7a4 4 0 0 0-4 4" />
                <path d="M19 7a8 8 0 0 0-8 8" />
            </svg>
        ),
        title: "Smart Call Routing",
        description: "Identifies serious buyers, urgent seller requests, and time-sensitive inquiries, then routes them to the right agent instantly."
    }
];

const FAQS = [
    {
        question: "How natural does the AI voice sound?",
        answer: "Our voice assistant is tuned for natural, professional conversations and can follow the pace of a buyer inquiry while staying within your approved listing information."
    },
    {
        question: "Can it coordinate showings across multiple agents?",
        answer: "Yes. The assistant can use real-time availability across agents, respect listing-specific showing rules, and route each request to the correct person."
    },
    {
        question: "What happens when a buyer is ready to act?",
        answer: "The assistant recognizes high-intent signals such as financing readiness or an immediate showing request and follows your escalation rules to notify or transfer the lead to an agent."
    },
    {
        question: "Can it answer questions about a specific listing?",
        answer: "Yes. Each assistant can be configured with approved details for a specific property, including price, features, availability, neighborhood context, and showing instructions."
    },
    {
        question: "Will it integrate with our existing systems?",
        answer: "The assistant can connect with common calendars, CRMs, lead-routing tools, and brokerage workflows. Integration scope is confirmed during setup."
    },
    {
        question: "How long does setup take?",
        answer: "A listing demo can be prepared quickly. Production setup depends on your listings, calendar, routing rules, and CRM requirements."
    },
    {
        question: "Can we customize the AI's responses?",
        answer: "Yes. You control the greeting, tone, approved property facts, qualification questions, escalation rules, and what the assistant must never claim."
    }
];

export default function VersionFive() {
    const [openFaq, setOpenFaq] = useState<number | null>(null);
    const [openChainItem, setOpenChainItem] = useState<number | null>(null);
    const [isVisible, setIsVisible] = useState<Record<string, boolean>>({});
    const observerRef = useRef<IntersectionObserver | null>(null);

    const [calcValues, setCalcValues] = useState({
        callsPerDay: 8,
        dealValue: 4000,
        missRate: 20
    });

    // Intersection Observer for scroll animations
    useEffect(() => {
        observerRef.current = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        setIsVisible((prev) => ({ ...prev, [entry.target.id]: true }));
                    }
                });
            },
            { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
        );

        const elements = document.querySelectorAll('[data-animate]');
        elements.forEach((el) => {
            observerRef.current?.observe(el);
        });

        return () => observerRef.current?.disconnect();
    }, []);

    return (
        <div className={styles.container}>
            {/* Floating Particles */}
            <div className={styles.particles}>
                {[...Array(30)].map((_, i) => (
                    <div
                        key={i}
                        className={styles.particle}
                        style={{
                            left: `${(i * 3.33) % 100}%`,
                            top: `${(i * 7.77) % 100}%`,
                            animationDelay: `${i * 0.5}s`,
                            animationDuration: `${20 + (i % 10)}s`
                        }}
                    />
                ))}
            </div>

            {/* Navigation */}
            <nav className={styles.nav}>
                <div className={styles.logo}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                    <span>Clarvoc</span>
                </div>
                <div className={styles.navRight}>
                    <div className={styles.secureBadge}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                            <path d="M9 12l2 2 4-4" />
                        </svg>
                        Built for Real Estate
                    </div>
                </div>
            </nav>

            {/* Hero Section */}
            <section className={styles.hero} data-track-view="v5_view_hero">
                <div className={styles.heroContent}>
                    <div className={styles.badge}>AI Voice & Chat for Real Estate</div>
                    <h1 className={styles.heroTitle}>
                        Turn Every <span className={styles.highlight}>Listing Inquiry</span> <br />
                        Into a Qualified Conversation
                    </h1>

                    {/* Key Benefits Bullets */}
                    <div className={styles.heroBullets}>
                        <div className={styles.bulletItem}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M9 12l2 2 4-4" />
                            </svg>
                            <span>Answers Property Questions Instantly</span>
                        </div>
                        <div className={styles.bulletItem}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M9 12l2 2 4-4" />
                            </svg>
                            <span>Coordinates Showing Requests — 24/7</span>
                        </div>
                        <div className={styles.bulletItem}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M9 12l2 2 4-4" />
                            </svg>
                            <span>Configured Around Your Listings</span>
                        </div>
                        <div className={styles.bulletItem}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M9 12l2 2 4-4" />
                            </svg>
                            <span>Escalates Serious Buyers to Your Team</span>
                        </div>
                    </div>

                    <div className={styles.heroCTA}>
                        <a href="/demo" className={styles.btnPrimary} data-track="v5_hero_demo">
                            Try Live Demo
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                                <path d="M4 10H16M16 10L11 5M16 10L11 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </a>
                    </div>

                    <div className={styles.trustBadges}>
                        {/* TODO: Add trust badges (ratings, certifications) */}
                    </div>
                </div>

                {/* Hero Visual - Waveform Animation */}
                <div className={styles.heroVisual}>
                    <div className={styles.visualCard}>
                        <div className={styles.waveform}>
                            {[...Array(40)].map((_, i) => (
                                <div
                                    key={i}
                                    className={styles.waveBar}
                                    style={{
                                        height: `${20 + Math.sin(i * 0.5) * 30 + (i % 5) * 4}px`,
                                        animationDelay: `${i * 0.05}s`
                                    }}
                                />
                            ))}
                        </div>
                        <div className={styles.visualText}>
                            <div className={styles.liveIndicator}>
                                <span className={styles.liveDot}></span>
                                LIVE
                            </div>
                            <p>&quot;Is the West Street property still available for a showing?&quot;</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* Problem Section - Two Column Layout */}
            <section id="problem" data-animate data-track-view="v5_view_problem" className={`${styles.problem} ${isVisible['problem'] ? styles.visible : ''}`}>
                <div className={styles.sectionHeader}>
                    <h2>The Hidden Cost of <span className={styles.highlightRed}>Slow Lead Response</span></h2>
                    <p>Every unanswered property inquiry can become another agent's conversation</p>
                </div>

                <div className={styles.problemColumns}>
                    {/* Left Column - The Reality */}
                    <div className={styles.problemLeft}>
                        <h3 className={styles.columnTitle}>The Reality</h3>

                        <div className={styles.chaosStory}>
                            <div className={styles.chaosItem}>
                                <div className={styles.chaosIcon}>
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72" />
                                    </svg>
                                </div>
                                <div className={styles.chaosContent}>
                                    <span className={styles.chaosTime}>9:30 AM</span>
                                    <p>A buyer asks about a listing while you are in a showing <span className={styles.chaosRed}>(unanswered)</span></p>
                                </div>
                            </div>

                            <div className={styles.chaosConnector}></div>

                            <div className={styles.chaosItem}>
                                <div className={styles.chaosIcon}>
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <circle cx="12" cy="12" r="10" />
                                        <path d="M8 15h8M9 9h.01M15 9h.01" />
                                    </svg>
                                </div>
                                <div className={styles.chaosContent}>
                                    <span className={styles.chaosTime}>10:15 AM</span>
                                    <p>The buyer wants details and is ready to schedule a tour</p>
                                </div>
                            </div>

                            <div className={styles.chaosConnector}></div>

                            <div className={styles.chaosItem}>
                                <div className={styles.chaosIcon}>
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <rect x="5" y="2" width="14" height="20" rx="2" />
                                        <path d="M12 18h.01" />
                                    </svg>
                                </div>
                                <div className={styles.chaosContent}>
                                    <span className={styles.chaosTime}>1:00 PM</span>
                                    <p>You return to the inquiry hours later</p>
                                </div>
                            </div>

                            <div className={styles.chaosConnector}></div>

                            <div className={styles.chaosItem}>
                                <div className={styles.chaosIcon}>
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2" />
                                        <line x1="1" y1="1" x2="23" y2="23" />
                                    </svg>
                                </div>
                                <div className={styles.chaosContent}>
                                    <span className={styles.chaosTime}>1:30 PM</span>
                                    <p>Follow up — <span className={styles.chaosRed}>the buyer has contacted another agent</span></p>
                                </div>
                            </div>

                            <div className={styles.chaosConnector}></div>

                            <div className={`${styles.chaosItem} ${styles.chaosItemLoss}`}>
                                <div className={styles.chaosIcon}>
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <line x1="12" y1="1" x2="12" y2="23" />
                                        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                                    </svg>
                                </div>
                                <div className={styles.chaosContent}>
                                    <span className={styles.chaosTime}>Result</span>
                                    <p className={styles.chaosLossText}>A qualified buyer conversation is lost</p>
                                </div>
                            </div>
                        </div>

                        {/* Chain Reaction Accordion */}
                        <div className={styles.chainReaction}>
                            <h4 className={styles.chainTitle}>The Domino Effect</h4>

                            {[
                                {
                                    title: "Lost Showing Opportunities",
                                    content: "Slow replies reduce the chance of securing the first conversation and the showing. The value is not the call itself, but the buyer relationship and transaction opportunity behind it."
                                },
                                {
                                    title: "Buyers Contact Other Agents",
                                    content: "Property shoppers often contact several agents at once. The first useful response is more likely to earn the showing and continue the relationship."
                                },
                                {
                                    title: "Repetitive Agent Work",
                                    content: "Agents repeatedly answer the same questions about price, availability, amenities, and showing times instead of focusing on qualified clients and transactions."
                                }
                            ].map((item, index) => (
                                <div key={index} className={styles.chainItem}>
                                    <button
                                        className={`${styles.chainQuestion} ${openChainItem === index ? styles.chainOpen : ''}`}
                                        onClick={() => {
                                            const isOpening = openChainItem !== index;
                                            trackAction(isOpening ? 'v5_chain_open' : 'v5_chain_close', item.title);
                                            setOpenChainItem(openChainItem === index ? null : index);
                                        }}
                                    >
                                        <span>{item.title}</span>
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </button>
                                    <div className={`${styles.chainAnswer} ${openChainItem === index ? styles.chainAnswerOpen : ''}`}>
                                        <p>{item.content}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Right Column - The Cost Calculator */}
                    <div className={styles.problemRight}>
                        <h3 className={styles.columnTitle}>The Cost</h3>

                        <div className={styles.calculator}>
                            <h4 className={styles.calcTitle}>Inquiry Value Requiring Fast Follow-Up</h4>

                            <div className={styles.calcSliders}>
                                <div className={styles.calcSliderGroup}>
                                    <div className={styles.calcSliderHeader}>
                                        <label>Listing inquiries per day</label>
                                        <span className={styles.calcValue}>{calcValues.callsPerDay}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="5"
                                        max="100"
                                        value={calcValues.callsPerDay}
                                        onChange={(e) => setCalcValues({ ...calcValues, callsPerDay: parseInt(e.target.value) })}
                                        onMouseUp={() => trackAction('v5_calc_slider', `calls_per_day:${calcValues.callsPerDay}`)}
                                        onTouchEnd={() => trackAction('v5_calc_slider', `calls_per_day:${calcValues.callsPerDay}`)}
                                        className={styles.calcSlider}
                                    />
                                    <div className={styles.calcSliderLabels}>
                                        <span>5</span>
                                        <span>100</span>
                                    </div>
                                </div>

                                <div className={styles.calcSliderGroup}>
                                    <div className={styles.calcSliderHeader}>
                                        <label>Average commission opportunity</label>
                                        <span className={styles.calcValue}>${calcValues.dealValue.toLocaleString('en-US')}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="500"
                                        max="50000"
                                        step="500"
                                        value={calcValues.dealValue}
                                        onChange={(e) => setCalcValues({ ...calcValues, dealValue: parseInt(e.target.value) })}
                                        onMouseUp={() => trackAction('v5_calc_slider', `deal_value:${calcValues.dealValue}`)}
                                        onTouchEnd={() => trackAction('v5_calc_slider', `deal_value:${calcValues.dealValue}`)}
                                        className={styles.calcSlider}
                                    />
                                    <div className={styles.calcSliderLabels}>
                                        <span>$500</span>
                                        <span>$50,000</span>
                                    </div>
                                </div>

                                <div className={styles.calcSliderGroup}>
                                    <div className={styles.calcSliderHeader}>
                                        <label>Delayed or missed inquiry rate</label>
                                        <span className={styles.calcValue}>{calcValues.missRate}%</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="10"
                                        max="70"
                                        value={calcValues.missRate}
                                        onChange={(e) => setCalcValues({ ...calcValues, missRate: parseInt(e.target.value) })}
                                        onMouseUp={() => trackAction('v5_calc_slider', `miss_rate:${calcValues.missRate}`)}
                                        onTouchEnd={() => trackAction('v5_calc_slider', `miss_rate:${calcValues.missRate}`)}
                                        className={styles.calcSlider}
                                    />
                                    <div className={styles.calcSliderLabels}>
                                        <span>10%</span>
                                        <span>70%</span>
                                    </div>
                                </div>
                            </div>

                            <div className={styles.calcResult}>
                                <div className={styles.calcResultAmount}>
                                    ${(calcValues.callsPerDay * calcValues.dealValue * (calcValues.missRate / 100) * WORKING_DAYS_PER_YEAR).toLocaleString('en-US')}
                                    <span>/year</span>
                                </div>
                                <p className={styles.calcResultLabel}>Maximum commission opportunity represented by delayed listing inquiries, not guaranteed lost revenue</p>
                            </div>

                            <div className={styles.hiddenCosts}>
                                <h5>Additional Brokerage Costs</h5>
                                <div className={styles.hiddenCostsGrid}>
                                    <div className={styles.hiddenCostItem}>
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                            <circle cx="9" cy="7" r="4" />
                                            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                                        </svg>
                                        <span className={styles.hiddenCostName}>Manual Inquiry Handling</span>
                                        <span className={styles.hiddenCostValue}>Time</span>
                                    </div>
                                    <div className={styles.hiddenCostItem}>
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <rect x="3" y="4" width="18" height="18" rx="2" />
                                            <path d="M16 2v4M8 2v4M3 10h18" />
                                        </svg>
                                        <span className={styles.hiddenCostName}>Showing No-Shows</span>
                                        <span className={styles.hiddenCostValue}>Leads</span>
                                    </div>
                                    <div className={styles.hiddenCostItem}>
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <circle cx="12" cy="12" r="10" />
                                            <polyline points="12 6 12 12 16 14" />
                                        </svg>
                                        <span className={styles.hiddenCostName}>After-Hours Leads</span>
                                        <span className={styles.hiddenCostValue}>Coverage</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Solution Section with Conversation Demo */}
            <section id="solution" data-animate data-track-view="v5_view_solution" className={`${styles.solution} ${isVisible['solution'] ? styles.visible : ''}`}>
                <div className={styles.solutionContent}>
                    <div className={styles.solutionText}>
                        <div className={styles.solutionBadge}>The Solution</div>
                        <h2 className={styles.solutionTitle}>
                            Your <span className={styles.highlight}>24/7 AI Listing Assistant</span> That Never Misses an Inquiry
                        </h2>
                        <p className={styles.solutionDescription}>
                            Clarvoc answers listing questions, captures buyer intent, and coordinates showing requests —
                            then hands qualified conversations to your team.
                        </p>

                        <div className={styles.capabilityList}>
                            <div className={styles.capabilityItem}>
                                <div className={styles.capabilityIcon}>
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                                    </svg>
                                </div>
                                <div>
                                    <h4>Sub-500ms Response</h4>
                                    <p>Natural conversation flow — no awkward pauses</p>
                                </div>
                            </div>
                            <div className={styles.capabilityItem}>
                                <div className={styles.capabilityIcon}>
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <rect x="3" y="4" width="18" height="18" rx="2" />
                                        <path d="M16 2v4M8 2v4M3 10h18" />
                                    </svg>
                                </div>
                                <div>
                                    <h4>Showing Calendar Sync</h4>
                                    <p>Coordinates requests using your existing availability</p>
                                </div>
                            </div>
                            <div className={styles.capabilityItem}>
                                <div className={styles.capabilityIcon}>
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <circle cx="12" cy="12" r="10" />
                                        <path d="M12 6v6l4 2" />
                                    </svg>
                                </div>
                                <div>
                                    <h4>24/7 Availability</h4>
                                    <p>Capture evening and weekend property inquiries automatically</p>
                                </div>
                            </div>
                        </div>

                        <a href="/demo" className={styles.btnDemo} data-track="v5_solution_demo">
                            Experience It Live
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M5 12h14M12 5l7 7-7 7" />
                            </svg>
                        </a>
                    </div>

                    {/* Conversation Demo */}
                    <div className={styles.solutionVisual}>
                        <div className={styles.conversationDemo}>
                            <div className={styles.conversationHeader}>
                                <div className={styles.conversationDot}></div>
                                <span>Live Conversation</span>
                            </div>
                            <div className={styles.conversationFlow}>
                                <div className={styles.messageIncoming}>
                                    <div className={styles.messageAvatar}>
                                        <svg viewBox="0 0 24 24" fill="currentColor">
                                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" />
                                        </svg>
                                    </div>
                                    <div className={styles.messageBubble}>
                                        <p>&quot;Hi, is the West Street listing still available, and could I see it tomorrow?&quot;</p>
                                        <span className={styles.messageTime}>Buyer</span>
                                    </div>
                                </div>

                                <div className={styles.messageOutgoing}>
                                    <div className={styles.messageBubble}>
                                        <p>&quot;Yes, it is active. The property has four bedrooms and four bathrooms. I can help request a showing at 11 AM or 3 PM tomorrow. Which works better?&quot;</p>
                                        <span className={styles.messageTime}>AI Listing Assistant &middot; 380ms</span>
                                    </div>
                                    <div className={styles.messageAvatarAI}>
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                        </svg>
                                    </div>
                                </div>

                                <div className={styles.messageIncoming}>
                                    <div className={styles.messageAvatar}>
                                        <svg viewBox="0 0 24 24" fill="currentColor">
                                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" />
                                        </svg>
                                    </div>
                                    <div className={styles.messageBubble}>
                                        <p>&quot;3 PM works. I am pre-approved and would like to tour it.&quot;</p>
                                        <span className={styles.messageTime}>Buyer</span>
                                    </div>
                                </div>

                                <div className={styles.messageOutgoing}>
                                    <div className={styles.messageBubble}>
                                        <p>&quot;Thanks. I have captured your request and financing status. The listing agent will confirm the 3 PM showing with you shortly.&quot;</p>
                                        <span className={styles.messageTime}>AI Listing Assistant &middot; 420ms</span>
                                    </div>
                                    <div className={styles.messageAvatarAI}>
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                        </svg>
                                    </div>
                                </div>
                            </div>
                            <div className={styles.actionIndicator}>
                                <div className={styles.actionIcon}>
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M9 12l2 2 4-4" />
                                        <circle cx="12" cy="12" r="10" />
                                    </svg>
                                </div>
                                <span>Buyer Qualified &middot; Showing Requested &middot; Agent Notified</span>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Features Section */}
            <section id="features" data-animate data-track-view="v5_view_features" className={`${styles.features} ${isVisible['features'] ? styles.visible : ''}`}>
                <div className={styles.sectionHeader}>
                    <h2>Everything Your Listing Inquiry Workflow Needs, <span className={styles.highlight}>Automated</span></h2>
                    <p>Property-specific voice and chat assistance built for real-estate teams</p>
                </div>

                <div className={styles.featureGrid}>
                    {FEATURES.map((feature, index) => (
                        <div key={index} className={styles.featureCard} style={{ animationDelay: `${index * 0.1}s` }}>
                            <div className={styles.featureIcon}>
                                {feature.icon}
                            </div>
                            <h3>{feature.title}</h3>
                            <p>{feature.description}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* Testimonials Section */}
            <section id="testimonials" data-animate data-track-view="v5_view_testimonials" className={`${styles.testimonials} ${isVisible['testimonials'] ? styles.visible : ''}`}>
                <div className={styles.sectionHeader}>
                    <h2>Real-Estate <span className={styles.highlight}>Workflow Examples</span></h2>
                    <p>Illustrative scenarios showing how listing inquiries move through the system</p>
                </div>

                <div className={styles.testimonialGrid}>
                    {TESTIMONIALS.map((testimonial, index) => (
                        <div key={index} className={styles.testimonialCard}>
                            <div className={styles.testimonialMetric}>{testimonial.metric}</div>
                            <p className={styles.testimonialQuote}>&quot;{testimonial.quote}&quot;</p>
                            <div className={styles.testimonialAuthor}>
                                <div className={styles.testimonialAvatar}>
                                    <Image
                                        src={testimonial.image}
                                        alt={testimonial.name}
                                        fill
                                        sizes="48px"
                                        style={{ objectFit: 'cover' }}
                                    />
                                </div>
                                <div>
                                    <div className={styles.testimonialName}>{testimonial.name}</div>
                                    <div className={styles.testimonialRole}>{testimonial.role}</div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* FAQ Section */}
            <section id="faq" data-animate data-track-view="v5_view_faq" className={`${styles.faq} ${isVisible['faq'] ? styles.visible : ''}`}>
                <div className={styles.sectionHeader}>
                    <h2>Frequently Asked <span className={styles.highlight}>Questions</span></h2>
                    <p>How Clarvoc fits into a real-estate inquiry workflow</p>
                </div>

                <div className={styles.faqContainer}>
                    {FAQS.map((faq, index) => (
                        <div key={index} className={styles.faqItem}>
                            <button
                                className={`${styles.faqQuestion} ${openFaq === index ? styles.faqOpen : ''}`}
                                onClick={() => {
                                    const isOpening = openFaq !== index;
                                    trackAction(isOpening ? 'v5_faq_open' : 'v5_faq_close', String(index));
                                    setOpenFaq(openFaq === index ? null : index);
                                }}
                            >
                                <span>{faq.question}</span>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>
                            <div className={`${styles.faqAnswer} ${openFaq === index ? styles.faqAnswerOpen : ''}`}>
                                <p>{faq.answer}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* Final CTA */}
            <section className={styles.finalCTA}>
                <div className={styles.ctaContent}>
                    <h2>See a Listing Assistant <span className={styles.highlight}>Handle a Buyer Inquiry</span></h2>
                    <p>Open the live demo and ask questions about a sample property.</p>
                    <div className={styles.ctaButtons}>
                        <a href="/demo" className={styles.btnPrimary} data-track="v5_cta_demo">
                            Try the Listing Demo
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                <path d="M12 19v3" />
                            </svg>
                        </a>
                        <a href="mailto:rudra@clarvoc.org" className={styles.btnSecondary} data-track="v5_cta_contact">
                            Contact Us
                        </a>
                    </div>
                    <p className={styles.ctaNote}>No signup required. Open the demo and start a conversation.</p>
                </div>
            </section>

            {/* Footer */}
            <footer className={styles.footer}>
                <p>&copy; 2026 Clarvoc. All rights reserved.</p>
            </footer>
        </div>
    );
}
