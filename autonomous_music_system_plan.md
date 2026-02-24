# Autonomous Adaptive Music System --- Implementation Plan (Option C: Fully Automated Server-Driven Architecture)

## Overview

This document defines a complete, implementation-ready plan for building
a personal autonomous music orchestration system that integrates with
Spotify and runs continuously on a server.

The system will:

-   Run 24/7 on a personal server.
-   Detect when a Spotify player becomes active.
-   Automatically start and manage a continuous adaptive music stream.
-   Learn from user behavior over time.
-   Allow real-time user steering via controls.
-   Generate playlists and insights automatically.
-   Optionally use a local LLM for reasoning and personalization.
-   Operate fully autonomously with minimal manual interaction.

This plan is designed so that an AI coding assistant (such as Claude)
can implement the system directly.

------------------------------------------------------------------------

# Core Philosophy

Music playback becomes a continuous feedback loop:

State → Select Track → Play → Observe Feedback → Update State → Repeat
Forever

No static playlists are required for operation.

------------------------------------------------------------------------

# Architecture (Option C --- Server-Based Automation)

## Key Principle

The intelligence engine runs on a server independently of devices.

Devices (phone, desktop, etc.) are only playback endpoints.

## High-Level Architecture

Server Components:

-   Scheduler
-   Spotify Integration Service
-   Continuous Playback Engine
-   Music Intelligence Engine
-   Database
-   AI Reasoning Module
-   REST API for UI clients

Client Components:

-   Flutter app (remote control + visualization)
-   Web dashboard (optional)

------------------------------------------------------------------------

# Spotify Player Detection

The system must continuously detect whether a Spotify player is
available.

Implementation:

-   Poll `/me/player` endpoint every 5--10 seconds.
-   Detect:
    -   active device
    -   playback state
    -   current track

If device becomes available → system attaches to session.

If playback stops → system decides whether to resume.

------------------------------------------------------------------------

# Continuous Playback Engine

Responsibilities:

-   Maintain current session state
-   Select next tracks
-   Preload upcoming tracks
-   Handle errors
-   Recover from interruptions
-   Adjust to user steering

Always maintain:

-   Current track
-   Next track
-   Buffer track

------------------------------------------------------------------------

# Music State Vector

Represents current musical context.

Example:

    energy: 0.55
    valence: 0.40
    bpm: 110
    genre_cluster: melodic techno
    familiarity: 0.8
    vocalness: 0.2
    aggressiveness: 0.3
    context: work
    fatigue_level: 0.2

Updated after each track.

------------------------------------------------------------------------

# Candidate Track Pool

Sources:

-   Saved tracks
-   Top tracks
-   Recently played
-   Recommendations API
-   Cached history
-   Discovery candidates

Filtered by:

-   BPM proximity
-   Energy similarity
-   Genre match
-   Context compatibility

------------------------------------------------------------------------

# Scoring Algorithm

Deterministic base scoring:

    score =
      w_state_similarity * similarity(current_state, track_features)
    + w_preference * user_preference_score
    + w_novelty * novelty_score
    + w_transition * transition_smoothness
    + w_fatigue * fatigue_penalty
    + w_context * context_match
    + w_recency * recency_penalty

Weights adjusted by:

-   User sliders
-   Learned preferences
-   AI suggestions

------------------------------------------------------------------------

# User Steering Controls

Expose adjustable axes:

-   Energy
-   Mood
-   Familiarity
-   Vocal vs instrumental
-   Aggressiveness
-   Genre openness
-   Focus vs party

These modify scoring weights dynamically.

------------------------------------------------------------------------

# Feedback Inputs

Capture:

-   Skip timing
-   Replay
-   Like / dislike
-   Listening duration
-   Slider adjustments

Update preference model accordingly.

------------------------------------------------------------------------

# Learning System

Track:

-   Skip probability
-   Completion rate
-   Repetition patterns
-   Time-of-day preferences
-   Context patterns

Update user preference scores continuously.

------------------------------------------------------------------------

# Anti-Repetition & Fatigue Logic

Prevent:

-   Overplayed songs
-   Recently skipped songs
-   Artist repetition

Detect fatigue:

-   Many skips
-   Reduced engagement

Adjust novelty accordingly.

------------------------------------------------------------------------

# Automation Engine

Triggers:

-   Time of day
-   Day of week
-   Device activation
-   Session history
-   Manual override

Behavior:

-   Automatically start playback when device appears.
-   Adapt session to context (work, gym, evening).

------------------------------------------------------------------------

# Local AI Integration

Optional but recommended.

Use cases:

-   Context inference
-   Strategy decisions
-   Playlist naming
-   Monthly summaries
-   Personal genre creation
-   Insight generation

AI must not directly control playback --- only influence weights and
strategy.

------------------------------------------------------------------------

# Embeddings System

Each track receives a vector combining:

-   Audio features
-   Genre
-   Interaction history

Used for:

-   Similarity search
-   Clustering
-   Transition smoothing

------------------------------------------------------------------------

# Database Schema

Core tables:

Tracks UserInteractions Sessions Preferences StateHistory

SQLite recommended.

------------------------------------------------------------------------

# Analytics & Insights

Compute:

-   Listening time distribution
-   Genre evolution
-   Energy trends
-   Discovery ratio
-   Monthly summaries

AI converts metrics into narratives.

------------------------------------------------------------------------

# Flutter Client

Functions:

-   Display current track
-   Mood sliders
-   Feedback buttons
-   Session visualization
-   Analytics dashboard
-   Settings

Client communicates with server via REST API.

------------------------------------------------------------------------

# Development Phases

## Phase 1 --- Spotify Integration

-   OAuth PKCE
-   Playback control
-   Track retrieval

## Phase 2 --- Continuous Engine

-   State vector
-   Candidate pool
-   Scoring
-   Infinite playback

## Phase 3 --- Learning

-   Interaction tracking
-   Preference updates

## Phase 4 --- Steering

-   Sliders
-   Feedback inputs

## Phase 5 --- Automation

-   Scheduler
-   Device detection
-   Auto-start sessions

## Phase 6 --- AI Integration

-   Local LLM connection
-   Prompt templates

## Phase 7 --- Analytics

-   Dashboards
-   Recaps

------------------------------------------------------------------------

# Claude AI Coding Instructions

This section tells Claude how to implement the system.

## General Rules

1.  Use clean modular architecture.
2.  Separate concerns strictly:
    -   Spotify service
    -   Playback engine
    -   Intelligence engine
    -   Database layer
    -   API layer
3.  Write strongly typed code where possible.
4.  Include unit tests for core algorithms.
5.  Avoid hardcoded values --- use configuration.
6.  Document public functions.
7.  Prefer deterministic logic over AI decisions.

------------------------------------------------------------------------

## Implementation Order for Claude

Step 1:

Create project structure:

server/ spotify/ playback/ intelligence/ database/ api/ scheduler/

Step 2:

Implement Spotify authentication and player control.

Step 3:

Implement database schema and repository layer.

Step 4:

Implement state vector model.

Step 5:

Implement candidate selection and scoring.

Step 6:

Implement continuous playback loop.

Step 7:

Implement REST API for client.

Step 8:

Add automation scheduler.

Step 9:

Integrate AI module.

------------------------------------------------------------------------

# Acceptance Criteria

System is complete when:

-   Music plays continuously without manual selection.
-   System adapts to feedback.
-   Sliders influence playback immediately.
-   Playback resumes automatically when device appears.
-   Analytics dashboard shows insights.
-   Generated playlists update automatically.

------------------------------------------------------------------------

# Final Goal

A fully autonomous personal music intelligence system that continuously
plays appropriate music while allowing real-time steering.
