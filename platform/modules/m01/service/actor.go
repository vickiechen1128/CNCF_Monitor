package service

import "context"

// Actor is the authenticated caller used for server-side ownership checks.
// Services must never trust tenant scoping supplied by the browser (SRS JG v1.2
// FR-JG-13): the handler injects the actor, and every ownership check reads it
// from the request context.
type Actor struct {
	TenantID        string
	IsPlatformAdmin bool
}

type actorContextKey struct{}

// WithActor attaches the session actor to a context.
func WithActor(ctx context.Context, actor Actor) context.Context {
	return context.WithValue(ctx, actorContextKey{}, actor)
}

// ActorFrom returns the session actor when one was injected.
func ActorFrom(ctx context.Context) (Actor, bool) {
	actor, ok := ctx.Value(actorContextKey{}).(Actor)
	if !ok || actor.TenantID == "" {
		return Actor{}, false
	}
	return actor, true
}
