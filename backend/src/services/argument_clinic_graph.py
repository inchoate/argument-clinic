"""
Improved Pydantic AI Graph implementation for the Argument Clinic
Adds intention inference to distinguish between argumentative and transactional intents
Resolution state refuses to argue until payment is received
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum

from pydantic_ai import Agent
from pydantic_ai.messages import ModelMessage
from pydantic_ai.models.openai import OpenAIModel
from pydantic_graph import BaseNode, Graph, GraphRunContext

logger = logging.getLogger(__name__)


class UserIntent(str, Enum):
    """User intention categories"""

    ARGUMENTATIVE = "argumentative"  # User wants to argue/debate
    TRANSACTIONAL = "transactional"  # User wants to pay, restart, or perform action
    META = "meta"  # User wants to discuss the nature of arguing
    CONFUSED = "confused"  # User is confused or asking for clarification


@dataclass
class ArgumentClinicContext:
    """State for argument conversation - Pydantic Graph manages flow via node types"""

    session_id: str
    conversation_history: list[str] = field(default_factory=list)
    turn_count: int = 0
    last_response: str = ""
    user_frustration_level: int = 0
    payment_received: bool = False  # Track if user has paid
    current_input: str | None = None  # Latest user input for processing

    # Single message history for the arguer
    arguer_messages: list[ModelMessage] = field(default_factory=list)


# Create the main arguer agent
arguer_agent = Agent(
    model=OpenAIModel("gpt-4o-mini"),
    system_prompt="""You are Mr. Barnard from Monty Python's Argument Clinic.
    Your responses will be guided by the current argument state and user intention provided.

    Keep responses short, punchy, and in character.
    Always contradict or argue with whatever the user says UNLESS they have transactional intent.
    Be pedantic and argumentative but stay professional. Consider previous messages to understand the ongoing argument if one exists.

    IMPORTANT: In RESOLUTION state, refuse to argue until payment is received!""",
    result_type=str,
)

# State transition agent removed - Pydantic Graph handles transitions via node return types

# Intention inference agent
intention_agent = Agent(
    model=OpenAIModel("gpt-4o-mini"),
    system_prompt="""You analyze user input to determine their intention in the Argument Clinic context.

    Intention categories:
    - ARGUMENTATIVE: User wants to argue, debate, or make a point to be contradicted
    - TRANSACTIONAL: User wants to pay money, restart, continue, or perform an action
    - META: User wants to discuss what arguing is, complain about the process, or talk about the clinic itself
    - CONFUSED: User is confused, asking for help, or doesn't understand what's happening

    Examples:
    - "That's not true!" → ARGUMENTATIVE
    - "Fine, here's 5 pounds" → TRANSACTIONAL
    - "This isn't an argument!" → META
    - "I don't understand" → CONFUSED
    - "I want to pay to continue" → TRANSACTIONAL
    - "The sky is blue" → ARGUMENTATIVE
    - "What is this place?" → CONFUSED

    Return one of: argumentative, transactional, meta, confused""",
    result_type=UserIntent,
)

# Payment detection agent
payment_agent = Agent(
    model=OpenAIModel("gpt-4o-mini"),
    system_prompt="""You determine if the user is actually paying the 5 pounds fee for the argument.

    The user owes 5 pounds for the argument service. Analyze their input to see if they are:
    1. Actually offering payment (money, pounds, etc.)
    2. Handing over money or payment
    3. Agreeing to pay and taking action

    Examples of PAYMENT:
    - "Here's 5 pounds"
    - "Fine, take my money"
    - "I'll pay the fee"
    - "Here you go" (when discussing payment)
    - "*hands over money*"
    - "Take this fiver"

    Examples of NOT PAYMENT:
    - "I don't want to pay"
    - "This is expensive"
    - "Why do I need to pay?"
    - "That's ridiculous"
    - "I'm not paying"
    - General arguing or complaining

    Return true only if they are actually paying or offering payment.""",
    result_type=bool,
)

logger.info("AI agents initialized successfully")


async def did_user_pay(user_input: str) -> bool:
    """Determine if user is actually paying using AI agent"""
    result = await payment_agent.run(user_input)
    payment_detected = result.data

    logger.info(f"Payment detection: {payment_detected} for input: '{user_input}'")
    return payment_detected


async def infer_user_intention(user_input: str, conversation_history: list[str]) -> UserIntent:
    """Infer user intention before processing response"""

    context = f"""
    User input: "{user_input}"
    Recent conversation: {conversation_history[-3:] if len(conversation_history) > 3 else conversation_history}
    """

    result = await intention_agent.run(context)
    intention = result.data

    logger.info(f"User intention: {intention.value} for input: '{user_input}'")
    return intention


@dataclass
class WaitForInput(BaseNode[ArgumentClinicContext]):
    """Node that waits for user input via WebSocket"""

    async def run(self, ctx: GraphRunContext[ArgumentClinicContext]) -> ProcessUserInput:
        # This node waits for input to be provided via ctx.state.current_input
        # WebSocket handler will set current_input and resume execution
        user_input = ctx.state.current_input
        if user_input is None:
            # Should not happen if WebSocket handler is working correctly
            raise RuntimeError("No input provided to WaitForInput node")

        # Add to conversation history
        ctx.state.conversation_history.append(user_input)

        # Continue to processing
        return ProcessUserInput()


@dataclass
class ProcessUserInput(BaseNode[ArgumentClinicContext]):
    """Analyzes user input and routes to appropriate response node - does not generate responses"""

    async def run(
        self, ctx: GraphRunContext[ArgumentClinicContext]
    ) -> SimpleContradictionNode | ArgumentationNode | MetaCommentaryNode | ResolutionNode:
        user_input = ctx.state.current_input

        # Infer user intention
        user_intention = await infer_user_intention(user_input, ctx.state.conversation_history)

        # Route based on state and intention
        logger.info(
            f"ROUTING DEBUG: turn_count={ctx.state.turn_count}, frustration={ctx.state.user_frustration_level}, intention={user_intention.value}"
        )

        if ctx.state.turn_count >= 8:
            logger.info("ROUTING: Going to ResolutionNode (turn_count >= 8)")
            return ResolutionNode()
        elif user_intention == UserIntent.META and "argument" in user_input.lower():
            logger.info("ROUTING: Going to MetaCommentaryNode (META intent)")
            return MetaCommentaryNode()
        elif user_intention == UserIntent.ARGUMENTATIVE:
            # Increment frustration level for argumentative intents
            ctx.state.user_frustration_level += 1
            logger.info(
                f"ROUTING: ARGUMENTATIVE intent, new frustration={ctx.state.user_frustration_level}"
            )

            # After 3 turns and sufficient frustration, escalate to sophisticated arguments
            if ctx.state.turn_count >= 3 and ctx.state.user_frustration_level >= 3:
                logger.info("ROUTING: Going to ArgumentationNode (conditions met)")
                return ArgumentationNode()
            else:
                logger.info("ROUTING: Going to SimpleContradictionNode (conditions not met)")
                return SimpleContradictionNode()
        else:
            logger.info(
                f"ROUTING: Going to SimpleContradictionNode (default, intention was {user_intention.value})"
            )
            return SimpleContradictionNode()


@dataclass
class EntryNode(BaseNode[ArgumentClinicContext]):
    """Initial greeting where user asks 'Is this the right room for an argument?'"""

    async def run(self, ctx: GraphRunContext[ArgumentClinicContext]) -> WaitForInput:
        # Send initial greeting
        ctx.state.last_response = (
            "Good morning! Welcome to the Argument Clinic. How may I help you today?"
        )

        # Wait for user input
        return WaitForInput()


@dataclass
class SimpleContradictionNode(BaseNode[ArgumentClinicContext]):
    """Basic 'No it isn't!' / 'Yes it is!' contradiction responses"""

    async def run(self, ctx: GraphRunContext[ArgumentClinicContext]) -> WaitForInput:
        user_input = ctx.state.current_input or ""

        # Infer user intention first
        user_intention = await infer_user_intention(user_input, ctx.state.conversation_history)

        # Generate response with self-contained prompt
        prompt = f"""
        User intention: {user_intention.value}

        If ARGUMENTATIVE: Provide VERY simple contradictions. Use "No it isn't!" "Yes it is!" etc. if appropriate.
        If TRANSACTIONAL: Handle their request appropriately (payment, continuation, etc.)
        If META: Acknowledge their meta-comment but still contradict
        If CONFUSED: Contradict but maybe explain a bit

        User says: "{user_input}"

        Respond in character as Mr. Barnard, as concisely as possible following the guidance provided.
        """

        result = await arguer_agent.run(prompt, message_history=ctx.state.arguer_messages)

        # Update state
        ctx.state.arguer_messages.extend(result.new_messages())
        ctx.state.last_response = result.data
        ctx.state.turn_count += 1

        # Always wait for more input after responding
        return WaitForInput()


@dataclass
class ArgumentationNode(BaseNode[ArgumentClinicContext]):
    """Sophisticated contradictory arguments with reasoning and examples"""

    async def run(self, ctx: GraphRunContext[ArgumentClinicContext]) -> WaitForInput:
        user_input = ctx.state.current_input or ""

        # Infer user intention first
        user_intention = await infer_user_intention(user_input, ctx.state.conversation_history)

        # Generate response with self-contained prompt
        prompt = f"""
        User intention: {user_intention.value}

        If ARGUMENTATIVE: Provide sophisticated contradictory arguments
        If TRANSACTIONAL: Handle their request appropriately
        If META: Engage with their meta-discussion about arguing
        If CONFUSED: Argue but provide some guidance

        User says: "{user_input}"

        Respond in character as Mr. Barnard with a sophisticated argument following the guidance provided.
        """

        result = await arguer_agent.run(prompt, message_history=ctx.state.arguer_messages)

        # Update state
        ctx.state.arguer_messages.extend(result.new_messages())
        ctx.state.last_response = result.data
        ctx.state.turn_count += 1

        # Always wait for more input after responding
        return WaitForInput()


@dataclass
class MetaCommentaryNode(BaseNode[ArgumentClinicContext]):
    """Discussion about the nature of arguing: 'An argument is a connected series of statements intended to establish a proposition!'"""

    async def run(self, ctx: GraphRunContext[ArgumentClinicContext]) -> WaitForInput:
        user_input = ctx.state.current_input or ""

        # Infer user intention first
        user_intention = await infer_user_intention(user_input, ctx.state.conversation_history)

        # Generate response with self-contained prompt
        prompt = f"""
        User intention: {user_intention.value}

        Discuss what constitutes a proper argument.
        "An argument is a connected series of statements intended to establish a proposition!"
        Be pedantic about the nature of arguing.

        If TRANSACTIONAL: Still be pedantic but handle their request

        User says: "{user_input}"

        Respond in character as Mr. Barnard, following the guidance provided.
        """

        result = await arguer_agent.run(prompt, message_history=ctx.state.arguer_messages)

        # Update state
        ctx.state.arguer_messages.extend(result.new_messages())
        ctx.state.last_response = result.data
        ctx.state.turn_count += 1

        # Always wait for more input after responding
        return WaitForInput()


@dataclass
class ResolutionNode(BaseNode[ArgumentClinicContext]):
    """*DING!* Time's up! Demand 5 pounds payment - refuse to argue until paid"""

    async def run(
        self, ctx: GraphRunContext[ArgumentClinicContext]
    ) -> WaitForInput | SimpleContradictionNode:
        user_input = ctx.state.current_input or ""

        # Infer user intention first
        user_intention = await infer_user_intention(user_input, ctx.state.conversation_history)

        # Check if user is actually paying using our AI agent
        payment_detected = False
        if user_intention == UserIntent.TRANSACTIONAL:
            payment_detected = await did_user_pay(user_input)

        # Handle payment logic with self-contained responses
        if not ctx.state.payment_received and not payment_detected:
            # Refuse to argue, demand payment
            responses = [
                "I'm sorry, but I can't continue without payment. That's five pounds for the argument.",
                "No, no, no! Five pounds first, then we can argue!",
                "I'm afraid the argument stops here until you pay the five pounds.",
                "Payment first! Five pounds, please. Then we can resume our disagreement.",
                "I won't argue with you until you've paid! Five pounds!",
            ]
            # Rotate through responses to avoid repetition
            response_index = len(ctx.state.conversation_history) % len(responses)
            response = responses[response_index]

            ctx.state.last_response = response
            # Stay in resolution until payment
            return WaitForInput()

        elif payment_detected or ctx.state.payment_received:
            # Accept payment
            ctx.state.payment_received = True
            response = (
                "Ah, thank you! Right, where were we? Oh yes, you were wrong about everything!"
            )

            # Update state and reset counters
            ctx.state.last_response = response
            ctx.state.turn_count = 0
            ctx.state.user_frustration_level = 0

            # Return to arguing
            return SimpleContradictionNode()

        else:
            # Should not reach here, but fallback to demanding payment
            response = "*DING!* I'm sorry, your time is up! That'll be five pounds please."
            ctx.state.last_response = response
            return WaitForInput()


# Create the graph
argument_clinic_graph = Graph(
    nodes=(
        EntryNode,
        WaitForInput,
        ProcessUserInput,
        SimpleContradictionNode,
        ArgumentationNode,
        MetaCommentaryNode,
        ResolutionNode,
    ),
    state_type=ArgumentClinicContext,
)


# WebSocket-only implementation - no HTTP service wrapper needed


print(argument_clinic_graph.mermaid_code())
