from playwright.sync_api import sync_playwright
import time

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width':1000,'height':1200})

    # intercept APIs with mock data
    def route_handler(route, request):
        url = request.url
        if '/api/list_plans.php' in url:
            route.fulfill(status=200, content_type='application/json', body='{"ok":true,"plans":[{"id":19,"name":"Level 5 Combined Finishes Plan-v2","revision":"v2","uploaded_at":"2026-01-24 11:00"}]}')
            return
        if '/api/get_plan.php' in url:
            route.fulfill(status=200, content_type='application/json', body='{"ok":true,"plan":{"id":19,"name":"Level 5 Combined Finishes Plan-v2","file_path":"storage/plans/level5.pdf"}}')
            return
        if '/api/list_issues.php' in url:
            body = '{"ok":true,"issues":['
            body += '{"id":21,"title":"Ook","notes":"Ttt","page":1,"created_at":"24/01/2026 10:52","status":"open","priority":"medium","assignee":""},'
            body += '{"id":22,"title":"test 99","notes":"mmmmmmmmmmmmmmmmmmmm","page":1,"created_at":"24/01/2026 11:23","status":"open","priority":"medium","assignee":""},'
            body += '{"id":23,"title":"Hhhh","notes":"Gggg","page":1,"created_at":"24/01/2026 11:33","status":"open","priority":"medium","assignee":""}'
            body += ']}'
            route.fulfill(status=200, content_type='application/json', body=body)
            return
        if '/api/list_photos.php' in url:
            body = '{"ok":true,"photos":[{"id":1,"issue_id":21,"thumb_url":"/storage/photos/thumb1.jpg","url":"/storage/photos/1.jpg"},{"id":2,"issue_id":22,"thumb_url":"/storage/photos/thumb2.jpg","url":"/storage/photos/2.jpg"},{"id":3,"issue_id":22,"thumb_url":"/storage/photos/thumb3.jpg","url":"/storage/photos/3.jpg"}]}'
            route.fulfill(status=200, content_type='application/json', body=body)
            return
        # fallback to normal
        route.continue_()

    page.route('**/api/*', route_handler)

    page.goto('http://127.0.0.1:8000/index.html')
    # wait for app to initialize
    time.sleep(1)
    # open a plan programmatically
    page.evaluate('window.openPlanInApp && window.openPlanInApp(19)')
    time.sleep(1)
    # click View Issues button (should be available after plan open)
    page.click('#btnViewIssues')
    # wait for modal
    page.wait_for_selector('#issuesModal', timeout=5000)
    time.sleep(1)
    # ensure modal is visible
    page.evaluate("document.getElementById('issuesModal').style.display='block';")
    time.sleep(0.5)
    # take screenshot of modal area
    modal = page.query_selector('#issuesModal .modal-content')
    if modal:
        modal.screenshot(path='/workspaces/survey/tools/live_modal.png')
    else:
        page.screenshot(path='/workspaces/survey/tools/live_full.png', full_page=True)

    browser.close()
    print('Screenshot saved')
