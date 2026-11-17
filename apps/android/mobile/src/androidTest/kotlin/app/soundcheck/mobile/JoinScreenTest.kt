package app.soundcheck.mobile

import android.net.Uri
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** UI tests for SoundCheck Mobile (no backend needed): code cleaning, deep links, tabs. */
@RunWith(AndroidJUnit4::class)
class JoinScreenTest {
    @get:Rule val compose = createComposeRule()

    @Test fun joinFormCleansCodeAndEnablesJoin() {
        compose.setContent { JoinFlow() }
        compose.onNodeWithText("Join the stage").assertExists()
        val join = compose.onNode(hasText("Join") and hasClickAction())
        join.assertIsNotEnabled()
        compose.onNodeWithContentDescription("Pairing code").performTextInput("ab-c2o34")   // lowercase, punctuation, ambiguous O dropped
        compose.onNodeWithText("ABC234").assertExists()
        join.assertIsEnabled()
    }

    @Test fun deepLinksYieldTheCode() {
        assertEquals("K7Q2PX", codeFrom(Uri.parse("soundcheck://join/k7q2px")))
        assertEquals("K7Q2PX", codeFrom(Uri.parse("https://soundcheck-gules.vercel.app/join/K7Q2PX")))
        assertNull(codeFrom(Uri.parse("https://example.com/other")))
    }

    @Test fun soloTabAsksToSignIn() {
        compose.setContent { Home(Triple(null, null, null)) }
        compose.onNode(hasText("Sing solo") and hasClickAction()).performClick()
        compose.waitUntil(10_000) { compose.onAllNodes(hasText("Sign in") and hasClickAction()).fetchSemanticsNodes().isNotEmpty() }
    }
}
