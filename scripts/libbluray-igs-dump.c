/*
 * Dump a decoded Interactive Graphics display set with libbluray 1.5.0's own
 * graphics processor. Used only to generate the pinned element-level evidence
 * in docs/evidence/; the test suite never links against libbluray.
 *
 * Build (needs the pinned libbluray source tree and its static library):
 *   clang -I<libbluray-src>/libbluray -I<libbluray-src> \
 *     scripts/libbluray-igs-dump.c <libbluray.a> -lxml2 -lz -lbz2 -liconv \
 *     -lfreetype -ludfread -framework CoreFoundation -framework DiskArbitration
 *
 * Usage: libbluray-igs-dump <6144-byte-aligned-units.bin> <pid>
 *
 * The input is an MPEG-2 TS stream whose 192-byte packets are grouped into
 * 6144-byte libbluray read units. Padding packets (PID 0x1fff) are ignored.
 */
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <inttypes.h>

#include "decoders/graphics_processor.h"
#include "decoders/ig.h"
#include "decoders/pg.h"

#define SAMPLE_COUNT 48

static void print_object(const BD_PG_OBJECT *o)
{
    const uint64_t total = (uint64_t)o->width * (uint64_t)o->height;
    uint8_t *pix = calloc(total ? total : 1, 1);
    uint64_t pos = 0;
    unsigned runs = 0, eols = 0;
    long first_nonzero = -1, last_nonzero = -1;

    if (o->img) {
        const BD_PG_RLE_ELEM *e = o->img;
        for (unsigned i = 0; i < 4000000 && pos < total; i++, e++) {
            if (e->len == 0) {
                eols++;
                if (o->width && pos % o->width) pos += o->width - (pos % o->width);
                continue;
            }
            runs++;
            for (unsigned k = 0; k < e->len && pos < total; k++)
                pix[pos++] = (uint8_t)e->color;
        }
    }
    for (uint64_t i = 0; i < total; i++) {
        if (pix[i]) {
            if (first_nonzero < 0) first_nonzero = (long)i;
            last_nonzero = (long)i;
        }
    }

    printf("[%u,%u,%u,%u,%u,%u,%ld,%ld,\"", o->id, o->version, o->width, o->height,
           runs, eols, first_nonzero, last_nonzero);
    for (unsigned k = 0; k < SAMPLE_COUNT; k++) {
        uint64_t index = total ? (uint64_t)k * (total - 1) / (SAMPLE_COUNT - 1) : 0;
        printf("%02x", pix[index]);
    }
    printf("\",[");
    for (unsigned bin = 0; bin < 16; bin++) {
        uint64_t count = 0;
        for (uint64_t i = 0; i < total; i++) if ((pix[i] >> 4) == bin) count++;
        if (bin) printf(",");
        printf("%" PRIu64, count);
    }
    printf("]]");
    free(pix);
}

static void print_palette(const BD_PG_PALETTE *p)
{
    printf("[%u,%u,\"", p->id, p->version);
    for (unsigned k = 0; k < 256; k++)
        printf("%02x%02x%02x%02x", p->entry[k].Y, p->entry[k].Cr, p->entry[k].Cb, p->entry[k].T);
    printf("\"]");
}

static void print_effect_sequence(const BD_IG_EFFECT_SEQUENCE *s)
{
    printf("[%u,%u,[", s->num_windows, s->num_effects);
    for (unsigned i = 0; i < s->num_effects; i++) {
        const BD_IG_EFFECT *e = &s->effect[i];
        if (i) printf(",");
        printf("[%" PRIu32 ",%u,%u,[", e->duration, e->palette_id_ref, e->num_composition_objects);
        for (unsigned k = 0; k < e->num_composition_objects; k++) {
            const BD_PG_COMPOSITION_OBJECT *c = &e->composition_object[k];
            if (k) printf(",");
            printf("[%u,%u,%u,%u,%u,%u,%u,%u,%u,%u]", c->object_id_ref, c->window_id_ref,
                   c->forced_on_flag, c->x, c->y, c->crop_flag, c->crop_x, c->crop_y,
                   c->crop_w, c->crop_h);
        }
        printf("]]");
    }
    printf("]]");
}

static void print_button(const BD_IG_BUTTON *b)
{
    printf("[%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u]",
           b->id, b->numeric_select_value, b->auto_action_flag, b->x_pos, b->y_pos,
           b->upper_button_id_ref, b->lower_button_id_ref, b->left_button_id_ref,
           b->right_button_id_ref,
           b->normal_start_object_id_ref, b->normal_end_object_id_ref, b->normal_repeat_flag,
           b->selected_start_object_id_ref, b->selected_end_object_id_ref,
           b->selected_repeat_flag, b->selected_sound_id_ref,
           b->activated_start_object_id_ref, b->activated_end_object_id_ref,
           b->activated_sound_id_ref, b->num_nav_cmds);
}

static void print_ics(const BD_IG_INTERACTIVE *ics)
{
    const BD_IG_INTERACTIVE_COMPOSITION *ic = &ics->interactive_composition;
    printf("{\"width\":%u,\"height\":%u,\"frameRate\":%u,\"number\":%u,\"state\":%u,"
           "\"streamModel\":%u,\"uiModel\":%u,\"timeouts\":[%" PRIu64 ",%" PRIu64 ",%" PRIu32 "],"
           "\"pages\":[",
           ics->video_descriptor.video_width, ics->video_descriptor.video_height,
           ics->video_descriptor.frame_rate, ics->composition_descriptor.number,
           ics->composition_descriptor.state, ic->stream_model, ic->ui_model,
           ic->composition_timeout_pts, ic->selection_timeout_pts, ic->user_timeout_duration);
    for (unsigned p = 0; p < ic->num_pages; p++) {
        const BD_IG_PAGE *page = &ic->page[p];
        if (p) printf(",");
        printf("[%u,%u,%u,%u,%u,%u,", page->id, page->version, page->palette_id_ref,
               page->default_selected_button_id_ref, page->default_activated_button_id_ref,
               page->animation_frame_rate_code);
        print_effect_sequence(&page->in_effects);
        printf(",");
        print_effect_sequence(&page->out_effects);
        printf(",%u,[", page->num_bogs);
        for (unsigned b = 0; b < page->num_bogs; b++) {
            const BD_IG_BOG *bog = &page->bog[b];
            if (b) printf(",");
            printf("[%u,%u,[", bog->default_valid_button_id_ref, bog->num_buttons);
            for (unsigned k = 0; k < bog->num_buttons; k++) {
                if (k) printf(",");
                print_button(&bog->button[k]);
            }
            printf("]]");
        }
        printf("]]");
    }
    printf("]}");
}

int main(int argc, char **argv)
{
    if (argc != 3) {
        fprintf(stderr, "usage: %s <units.bin> <pid>\n", argv[0]);
        return 2;
    }
    FILE *f = fopen(argv[1], "rb");
    if (!f) { perror("fopen"); return 2; }
    if (fseek(f, 0, SEEK_END) != 0) return 2;
    long size = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (size <= 0 || size % 6144) { fprintf(stderr, "input is not 6144-byte aligned: %ld\n", size); return 2; }
    uint8_t *buf = malloc((size_t)size);
    if (!buf || fread(buf, 1, (size_t)size, f) != (size_t)size) { fprintf(stderr, "short read\n"); return 2; }
    fclose(f);
    uint16_t pid = (uint16_t)strtoul(argv[2], NULL, 0);

    GRAPHICS_PROCESSOR *gp = graphics_processor_init();
    PG_DISPLAY_SET *s = NULL;
    if (!gp) { fprintf(stderr, "graphics_processor_init failed\n"); return 3; }
    int complete = graphics_processor_decode_ts(gp, &s, pid, buf, (unsigned)(size / 6144), -1);
    if (!complete || !s || !s->complete || !s->ics) {
        fprintf(stderr, "libbluray did not decode a complete IG display set\n");
        return 3;
    }

    printf("{\"complete\":%d,\"epochStart\":%u,\"validPts\":\"%" PRId64 "\","
           "\"numPalette\":%u,\"numObject\":%u,\"numWindow\":%u,\"ics\":",
           complete, s->epoch_start, s->valid_pts, s->num_palette, s->num_object, s->num_window);
    print_ics(s->ics);
    printf(",\"palettes\":[");
    for (unsigned i = 0; i < s->num_palette; i++) { if (i) printf(","); print_palette(&s->palette[i]); }
    printf("],\"objects\":[");
    for (unsigned i = 0; i < s->num_object; i++) { if (i) printf(","); print_object(&s->object[i]); }
    printf("]}\n");

    pg_display_set_free(&s);
    graphics_processor_free(&gp);
    free(buf);
    return 0;
}
