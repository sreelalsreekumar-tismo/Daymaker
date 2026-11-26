using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Daymaker.Api.Auth;

/// <summary>Blocks personal access tokens that lack the "write" or "delete" scope. JWT sessions always pass.</summary>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class)]
public class RequireScopeAttribute(string scope) : Attribute, IAsyncActionFilter
{
    public Task OnActionExecutionAsync(ActionExecutingContext ctx, ActionExecutionDelegate next)
    {
        var claim = ctx.HttpContext.User.FindFirst("scope_" + scope)?.Value;
        if (claim == "false")
            ctx.Result = new ObjectResult(new ProblemDetails { Title = $"Token lacks the '{scope}' permission", Status = 403 }) { StatusCode = 403 };
        return claim == "false" ? Task.CompletedTask : next();
    }
}
