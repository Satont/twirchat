#include <libweston/libweston.h>
#include <libweston/desktop.h>
#include <linux/input-event-codes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

/* Weston 15 exports these input hooks through its private backend API. */
void notify_motion_absolute(struct weston_seat *, const struct timespec *,
                            struct weston_coord_global);
void notify_button(struct weston_seat *, const struct timespec *, int32_t,
                   enum wl_pointer_button_state);
void notify_pointer_frame(struct weston_seat *);

struct qa_controls {
    struct weston_compositor *compositor;
    struct wl_event_source *timer;
    struct wl_listener destroy;
    char command[4096];
    char reply[4096];
    char pending_reply[4096];
};

static bool click_view(struct weston_view *view, FILE *request)
{
    char coordinates[64];
    if (!fgets(coordinates, sizeof(coordinates), request) ||
        !strchr(coordinates, '\n') || fgetc(request) != EOF)
        return false;

    char *end;
    long x = strtol(coordinates, &end, 10);
    if (end == coordinates || (*end != ' ' && *end != '\t'))
        return false;
    const char *second = end + strspn(end, " \t");
    long y = strtol(second, &end, 10);
    if (end == second || end[strspn(end, " \t\r\n")] ||
        x < 0 || x >= view->surface->width || y < 0 || y >= view->surface->height)
        return false;

    struct weston_compositor *compositor = view->surface->compositor;
    weston_view_update_transform(view);
    struct weston_coord_global position = weston_coord_surface_to_global(
        view, weston_coord_surface(x, y, view->surface));
    struct timespec time;
    if (weston_compositor_pick_view(compositor, position) != view ||
        clock_gettime(CLOCK_MONOTONIC, &time) != 0)
        return false;

    struct weston_seat *seat;
    wl_list_for_each(seat, &compositor->seat_list, link) {
        struct weston_keyboard *keyboard = weston_seat_get_keyboard(seat);
        struct weston_pointer *pointer = weston_seat_get_pointer(seat);
        if (!keyboard || keyboard->focus != view->surface || !pointer ||
            pointer->grab != &pointer->default_grab || pointer->button_count)
            continue;
        notify_motion_absolute(seat, &time, position);
        notify_pointer_frame(seat);
        if (pointer->focus != view)
            continue;
        notify_button(seat, &time, BTN_LEFT, WL_POINTER_BUTTON_STATE_PRESSED);
        notify_pointer_frame(seat);
        notify_button(seat, &time, BTN_LEFT, WL_POINTER_BUTTON_STATE_RELEASED);
        notify_pointer_frame(seat);
        return true;
    }
    return false;
}

static int poll_command(void *data)
{
    struct qa_controls *controls = data;
    FILE *request = fopen(controls->command, "r");
    if (request) {
        char action[32];
        char title[512];
        int found = 0;
        if (fgets(action, sizeof(action), request) && fgets(title, sizeof(title), request)) {
            action[strcspn(action, "\r\n")] = 0;
            title[strcspn(title, "\r\n")] = 0;
            struct weston_view *view;
            wl_list_for_each(view, &controls->compositor->view_list, link) {
                if (!weston_surface_is_desktop_surface(view->surface))
                    continue;
                struct weston_desktop_surface *surface =
                    weston_surface_get_desktop_surface(view->surface);
                const char *current = weston_desktop_surface_get_title(surface);
                if (!current || strcmp(current, title) || !view->surface->is_mapped)
                    continue;
                found = 1;
                if (!strcmp(action, "click"))
                    found = click_view(view, request);
                else if (!strcmp(action, "close"))
                    weston_desktop_surface_close(surface);
                else if (!strcmp(action, "focus")) {
                    struct weston_view *other;
                    wl_list_for_each(other, &controls->compositor->view_list, link) {
                        if (weston_surface_is_desktop_surface(other->surface))
                            weston_desktop_surface_set_activated(
                                weston_surface_get_desktop_surface(other->surface),
                                other->surface == view->surface);
                    }
                    struct weston_seat *seat;
                    wl_list_for_each(seat, &controls->compositor->seat_list, link)
                        weston_view_activate_input(view, seat, WESTON_ACTIVATE_FLAG_CONFIGURE);
                }
                break;
            }
        }
        fclose(request);
        unlink(controls->command);
        FILE *reply = fopen(controls->pending_reply, "w");
        if (reply) {
            fprintf(reply, "%d\n", found);
            fclose(reply);
            rename(controls->pending_reply, controls->reply);
        }
    }
    wl_event_source_timer_update(controls->timer, 20);
    return 0;
}

static void destroy_controls(struct wl_listener *listener, void *data)
{
    (void)data;
    struct qa_controls *controls = wl_container_of(listener, controls, destroy);
    wl_event_source_remove(controls->timer);
    wl_list_remove(&controls->destroy.link);
    free(controls);
}

WL_EXPORT int wet_module_init(struct weston_compositor *compositor, int *argc, char *argv[])
{
    (void)argc;
    (void)argv;
    const char *qa = getenv("TWIRCHAT_GUI_QA");
    const char *runtime = getenv("TWIRCHAT_QA_RUNTIME");
    if (!qa || strcmp(qa, "1") || !runtime)
        return -1;
    struct qa_controls *controls = calloc(1, sizeof(*controls));
    if (!controls)
        return -1;
    if (snprintf(controls->command, sizeof(controls->command), "%s/weston-command", runtime) >=
            (int)sizeof(controls->command) ||
        snprintf(controls->reply, sizeof(controls->reply), "%s/weston-reply", runtime) >=
            (int)sizeof(controls->reply) ||
        snprintf(controls->pending_reply, sizeof(controls->pending_reply), "%s/weston-reply.pending", runtime) >=
            (int)sizeof(controls->pending_reply)) {
        free(controls);
        return -1;
    }
    controls->compositor = compositor;
    controls->timer = wl_event_loop_add_timer(
        wl_display_get_event_loop(compositor->wl_display), poll_command, controls);
    if (!controls->timer) {
        free(controls);
        return -1;
    }
    controls->destroy.notify = destroy_controls;
    wl_signal_add(&compositor->destroy_signal, &controls->destroy);
    wl_event_source_timer_update(controls->timer, 20);
    return 0;
}
