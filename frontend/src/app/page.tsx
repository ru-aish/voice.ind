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
        name: "Rajesh Mehta",
        role: "CEO, TechScale Solutions",
        quote: "We were losing 40% of leads because nobody picked up calls after hours. Ab har call attend hoti hai, and bookings are up 67%. Total game changer for our business.",
        metric: "67% more conversions",
        image: "/images/testimonials/michael.png"
    },
    {
        name: "Priya Sharma",
        role: "Operations Head, GrowthBox",
        quote: "The AI handles inquiries, schedules demos, and follows up — sab kuch automatic. Our team now focuses only on closing deals instead of answering phones all day.",
        metric: "₹8L saved monthly",
        image: "/images/testimonials/sarah.png"
    },
    {
        name: "Amit Verma",
        role: "Founder, QuickServ India",
        quote: "Customer complaints about wait times dropped 90%. The AI picks up instantly and resolves queries faster than any receptionist we ever hired. Best investment this year.",
        metric: "90% faster response",
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
        title: "Smart Appointment Booking",
        description: "Customers book, reschedule, or cancel 24/7. Real-time calendar sync with your existing tools — no double bookings, ever."
    },
    {
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M9 12l2 2 4-4" />
                <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
            </svg>
        ),
        title: "Instant Query Resolution",
        description: "Answers FAQs about your services, pricing, hours, and availability — no human needed. Customers get instant help."
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
        description: "Captures caller details, qualifies leads based on your criteria, and sends them straight to your CRM automatically."
    },
    {
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
        ),
        title: "Automated Follow-ups",
        description: "Sends reminders, confirmation messages, and follow-up calls automatically. Reduces no-shows and keeps customers engaged."
    },
    {
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            </svg>
        ),
        title: "Natural Voice Conversations",
        description: "Sounds 100% human. Callers can't tell it's AI — warm, natural, and adapts to conversation flow in real-time."
    },
    {
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                <path d="m15 5 4 4" />
            </svg>
        ),
        title: "Reschedule & Cancel",
        description: "Customers manage their own appointments easily, freeing your staff for high-value work that actually needs a human."
    },
    {
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4" />
                <path d="M12 8h.01" />
            </svg>
        ),
        title: "Business Information",
        description: "Answers questions about services, locations, hours, directions, and what to expect — like your best receptionist, but 24/7."
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
        description: "Identifies urgent situations and routes them to the right person instantly. No important call ever gets lost."
    }
];

const FAQS = [
    {
        question: "How natural does the AI voice sound?",
        answer: "Our AI uses state-of-the-art voice synthesis tuned for natural conversation. In blind tests, 92% of callers couldn't tell they were speaking with an AI. The voice is warm, professional, and adapts its pace based on the caller's needs — Hindi, English, or Hinglish."
    },
    {
        question: "Can it handle complex scheduling with multiple team members?",
        answer: "Bilkul. The AI integrates with your calendar to see real-time availability across all team members. It can match customers with specific people, handle recurring appointments, and respect your scheduling rules — sab automatically."
    },
    {
        question: "What happens if a caller has an urgent issue?",
        answer: "The AI recognizes urgent situations and follows your defined escalation protocols. It can immediately transfer to on-call staff, take detailed messages for urgent callback, or provide emergency instructions as you configure."
    },
    {
        question: "Kya yeh Hindi mein baat kar sakta hai?",
        answer: "Haan, bilkul! Our AI supports Hindi, English, and Hinglish conversations naturally. It detects the caller's language preference and switches seamlessly — no awkward transitions."
    },
    {
        question: "Will it integrate with our existing systems?",
        answer: "We integrate with all major CRMs, calendar systems, and business tools — Zoho, Google Workspace, HubSpot, and more. Setup is seamless and bi-directional, so changes made anywhere are reflected everywhere."
    },
    {
        question: "How long does setup take?",
        answer: "Most businesses are fully operational within 2-3 hours. We handle the technical integration, train the AI on your specific services and policies, and provide a dedicated success manager for the first 30 days."
    },
    {
        question: "Can we customize the AI's responses?",
        answer: "Absolutely. You control the greeting, personality, and specific responses for your business. Want the AI to mention your specialties, promote new offers, or follow specific scripts? It's all customizable through our dashboard."
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

    const testimonials = [
        {
            name: "Rajesh Mehta",
            role: "CEO, TechScale Solutions",
            quote: "We were losing 40% of leads because nobody picked up calls after hours. Ab har call attend hoti hai, and bookings are up 67%. Total game changer for our business.",
            metric: "67% more conversions",
            image: "/images/testimonials/michael.png"
        },
        {
                            top: `${Math.random() * 100}%`,
                            animationDelay: `${Math.random() * 20}s`,
                            animationDuration: `${20 + Math.random() * 30}s`
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
                    <span>ElevixAI</span>
                </div>
                <div className={styles.navRight}>
                    <div className={styles.secureBadge}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                            <path d="M9 12l2 2 4-4" />
                        </svg>
                        Enterprise Secure
                    </div>
                </div>
            </nav>

            {/* Hero Section */}
            <section className={styles.hero} data-track-view="v5_view_hero">
                <div className={styles.heroContent}>
                    <div className={styles.badge}>AI-Powered Voice Agent</div>
                    <h1 className={styles.heroTitle}>
                        Stop Losing <span className={styles.highlight}>₹50,000+</span> <br />
                        Every Month to Missed Calls
                    </h1>

                    {/* Key Benefits Bullets */}
                    <div className={styles.heroBullets}>
                        <div className={styles.bulletItem}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M9 12l2 2 4-4" />
                            </svg>
                            <span>Sounds 100% Human — Bilkul Real Lagta Hai</span>
                        </div>
                        <div className={styles.bulletItem}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M9 12l2 2 4-4" />
                            </svg>
                            <span>Books Appointments Instantly — 24/7</span>
                        </div>
                        <div className={styles.bulletItem}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M9 12l2 2 4-4" />
                            </svg>
                            <span>48-Hour Setup — Hum Sab Karenge</span>
                        </div>
                        <div className={styles.bulletItem}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M9 12l2 2 4-4" />
                            </svg>
                            <span>No Lock-in, Cancel Anytime</span>
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
                                        height: `${20 + Math.sin(i * 0.5) * 30 + Math.random() * 20}px`,
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
                            <p>&quot;Hi, I want to book an appointment for tomorrow...&quot;</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* Problem Section - Two Column Layout */}
            <section id="problem" data-animate data-track-view="v5_view_problem" className={`${styles.problem} ${isVisible['problem'] ? styles.visible : ''}`}>
                <div className={styles.sectionHeader}>
                    <h2>The Hidden Cost of <span className={styles.highlightRed}>Missed Calls</span></h2>
                    <p>Har ek missed call = ek customer jo competitor ke paas gaya</p>
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
                                    <p>Customer calls during a meeting <span className={styles.chaosRed}>(voicemail)</span></p>
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
                                    <p>Customer needs urgent help — ready to pay</p>
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
                                    <p>You finally check missed calls during lunch</p>
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
                                    <p>Call back — <span className={styles.chaosRed}>already went to competitor</span></p>
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
                                    <p className={styles.chaosLossText}>-₹50,000+ lifetime customer value lost</p>
                                </div>
                            </div>
                        </div>

                        {/* Chain Reaction Accordion */}
                        <div className={styles.chainReaction}>
                            <h4 className={styles.chainTitle}>The Domino Effect</h4>

                            {[
                                {
                                    title: "Empty Calendar Slots",
                                    content: "Missed calls mean empty time slots. With average deal values of ₹5,000-50,000, just 2 missed opportunities per day costs your business over ₹25 lakhs annually in lost revenue."
                                },
                                {
                                    title: "Customers Go to Competitors",
                                    content: "When customers can't reach you, they call the next business. 85% of callers won't leave a voicemail — they simply move on to someone who picks up."
                                },
                                {
                                    title: "Team Burnout & Turnover",
                                    content: "Your team shouldn't be answering phones all day. Juggling core work and phone calls leads to burnout, mistakes, and high turnover costs averaging ₹1.5L per employee."
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
                            <h4 className={styles.calcTitle}>Your Business&apos;s Lost Revenue</h4>

                            <div className={styles.calcSliders}>
                                <div className={styles.calcSliderGroup}>
                                    <div className={styles.calcSliderHeader}>
                                        <label>Customer calls per day</label>
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
                                        <label>Average deal value</label>
                                        <span className={styles.calcValue}>₹{calcValues.dealValue.toLocaleString('en-IN')}</span>
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
                                        <span>₹500</span>
                                        <span>₹50,000</span>
                                    </div>
                                </div>

                                <div className={styles.calcSliderGroup}>
                                    <div className={styles.calcSliderHeader}>
                                        <label>Missed call rate</label>
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
                                    ₹{(calcValues.callsPerDay * calcValues.dealValue * (calcValues.missRate / 100) * WORKING_DAYS_PER_YEAR).toLocaleString('en-IN')}
                                    <span>/year</span>
                                </div>
                                <p className={styles.calcResultLabel}>Lost revenue from missed customer calls</p>
                            </div>

                            <div className={styles.hiddenCosts}>
                                <h5>Additional Business Costs</h5>
                                <div className={styles.hiddenCostsGrid}>
                                    <div className={styles.hiddenCostItem}>
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                            <circle cx="9" cy="7" r="4" />
                                            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                                        </svg>
                                        <span className={styles.hiddenCostName}>Receptionist</span>
                                        <span className={styles.hiddenCostValue}>₹3.5L</span>
                                    </div>
                                    <div className={styles.hiddenCostItem}>
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <rect x="3" y="4" width="18" height="18" rx="2" />
                                            <path d="M16 2v4M8 2v4M3 10h18" />
                                        </svg>
                                        <span className={styles.hiddenCostName}>No-Shows</span>
                                        <span className={styles.hiddenCostValue}>₹2L</span>
                                    </div>
                                    <div className={styles.hiddenCostItem}>
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <circle cx="12" cy="12" r="10" />
                                            <polyline points="12 6 12 12 16 14" />
                                        </svg>
                                        <span className={styles.hiddenCostName}>After-Hours</span>
                                        <span className={styles.hiddenCostValue}>₹4L</span>
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
                            Your <span className={styles.highlight}>24/7 AI Receptionist</span> That Never Misses a Call
                        </h2>
                        <p className={styles.solutionDescription}>
                            Our AI answers every call instantly, handles bookings, resolves queries, and captures leads —
                            all while sounding indistinguishable from your best team member.
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
                                    <h4>Real-Time Calendar Sync</h4>
                                    <p>Books directly into your existing systems</p>
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
                                    <p>Capture night &amp; weekend calls automatically</p>
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
                                        <p>&quot;Hi, I need to book an appointment for tomorrow. Do you have any slots available?&quot;</p>
                                        <span className={styles.messageTime}>Customer</span>
                                    </div>
                                </div>

                                <div className={styles.messageOutgoing}>
                                    <div className={styles.messageBubble}>
                                        <p>&quot;Of course! I have openings tomorrow at 11 AM and 3 PM. Which time works better for you?&quot;</p>
                                        <span className={styles.messageTime}>AI Receptionist &middot; 380ms</span>
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
                                        <p>&quot;3 PM works. What are your charges for consultation?&quot;</p>
                                        <span className={styles.messageTime}>Customer</span>
                                    </div>
                                </div>

                                <div className={styles.messageOutgoing}>
                                    <div className={styles.messageBubble}>
                                        <p>&quot;Great choice! I&apos;ve booked you for 3 PM tomorrow. You&apos;ll receive a confirmation SMS shortly with all the details. Anything else I can help with?&quot;</p>
                                        <span className={styles.messageTime}>AI Receptionist &middot; 420ms</span>
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
                                <span>Booked &middot; SMS Sent &middot; Calendar Updated</span>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Features Section */}
            <section id="features" data-animate data-track-view="v5_view_features" className={`${styles.features} ${isVisible['features'] ? styles.visible : ''}`}>
                <div className={styles.sectionHeader}>
                    <h2>Everything Your Receptionist Does, <span className={styles.highlight}>Automated</span></h2>
                    <p>Comprehensive call handling built for every business</p>
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
                    <h2>Trusted by <span className={styles.highlight}>Businesses</span> Across India</h2>
                    <p>Real results from real businesses — seedha numbers</p>
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
                    <p>Sab kuch jaaniye ElevixAI ke baare mein</p>
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
                    <h2>Ready to Try? <span className={styles.highlight}>Abhi Baat Karo</span></h2>
                    <p>Experience firsthand how our AI handles conversations — ask anything.</p>
                    <div className={styles.ctaButtons}>
                        <a href="/demo" className={styles.btnPrimary} data-track="v5_cta_demo">
                            Talk to AI Now
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                <path d="M12 19v3" />
                            </svg>
                        </a>
                        <a href="mailto:query@elevix.site" className={styles.btnSecondary} data-track="v5_cta_contact">
                            Contact Us
                        </a>
                    </div>
                    <p className={styles.ctaNote}>No signup required. Seedha baat karo.</p>
                </div>
            </section>

            {/* Footer */}
            <footer className={styles.footer}>
                <p>&copy; 2025 ElevixAI. All rights reserved.</p>
            </footer>
        </div>
    );
}
