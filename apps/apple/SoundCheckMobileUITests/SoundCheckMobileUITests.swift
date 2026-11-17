import XCTest

/// UI smoke tests for SoundCheck Mobile (no backend needed): join form, code cleaning, and the solo tab.
final class SoundCheckMobileUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    func testJoinFormCleansCodeAndEnablesJoin() {
        let app = XCUIApplication()
        app.launchArguments = ["--uitest-reset"]
        app.launch()
        XCTAssertTrue(app.staticTexts["Join the stage"].waitForExistence(timeout: 10))
        let join = app.buttons["Join"]
        XCTAssertFalse(join.isEnabled, "Join needs a 6-character code")
        let code = app.textFields["Pairing code"]
        code.tap()
        code.typeText("ab-c2o34")           // lowercase, punctuation and the ambiguous O are dropped
        XCTAssertEqual(code.value as? String, "ABC234")
        XCTAssertTrue(join.isEnabled)
    }

    func testSoloTabAsksToSignIn() {
        let app = XCUIApplication()
        app.launchArguments = ["--uitest-reset"]
        app.launch()
        app.buttons["Sing solo"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Sing solo"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.secureTextFields["Password"].exists)
    }
}
